from typing import Any, Callable, Dict, List, Literal, Optional, Tuple
from typing_extensions import TypedDict

from opik_optimizer.demo import get_or_create_dataset
from opik.integrations.langchain import OpikTracer
from opik.evaluation.metrics import LevenshteinRatio
from opik_optimizer import (
    TaskConfig,
    MetricConfig,
    from_dataset_field,
    from_llm_response_text,
)
from opik_optimizer.agent_optimizer import OpikAgentOptimizer, OpikAgent

from langgraph.graph import StateGraph, START, END
from langchain_openai import ChatOpenAI
from langchain.agents import Tool, create_react_agent, AgentExecutor
from langchain_core.prompts import PromptTemplate

# Tools:
import dspy


def search_wikipedia(query: str) -> list[str]:
    """
    This agent is used to search wikipedia. It can retrieve additional details
    about a topic.
    """
    results = dspy.ColBERTv2(url="http://20.102.90.50:2017/wiki17_abstracts")(
        query, k=1
    )
    return results[0]["text"]


class InputState(TypedDict):
    input: str


# Define the schema for the output
class OutputState(TypedDict):
    output: str


# Define the overall schema, combining both input and output
class OverallState(InputState, OutputState):
    pass


project_name = "langchain-agent"
dataset = get_or_create_dataset("hotpot-300")

prompt_template = """Answer the following questions as best you can. You have access to the following tools:

{tools}

Use the following format:

Question: "the input question you must answer"
Thought: "you should always think about what to do"
Action: "the action to take" --- should be one of [{tool_names}]
Action Input: "the input to the action"
Observation: "the result of the action"
... (this Thought/Action/Action Input/Observation can repeat N times)
Thought: "I now know the final answer"
Final Answer: "the final answer to the original input question"

Begin!

Question: {input}
Thought: {agent_scratchpad}"""

metric_config = MetricConfig(
    metric=LevenshteinRatio(project_name=project_name),
    inputs={
        "output": from_llm_response_text(),
        "reference": from_dataset_field(name="answer"),
    },
)

task_config = TaskConfig(
    instruction_prompt=prompt_template,
    input_dataset_fields=["question"],
    output_dataset_field="answer",
)


class LangGraphAgent(OpikAgent):
    def __init__(self, optimizer, agent_config):
        self.optimizer = optimizer
        if agent_config["system-prompt"]["template"]:
            prompt_template = agent_config["system-prompt"]["value"]
            prompt = PromptTemplate.from_template(prompt_template)
        else:
            prompt = agent_config["system-prompt"]["value"]

        agent_tools = []
        for key in agent_config:
            item = agent_config[key]
            if item["type"] == "tool":
                agent_tools.append(
                    Tool(
                        name=key,
                        func=item["function"],
                        description=item["value"],
                    )
                )
        self.llm = ChatOpenAI(model="gpt-4o", temperature=0, stream_usage=True)

        agent = create_react_agent(self.llm, tools=agent_tools, prompt=prompt)
        agent_executor = AgentExecutor(
            agent=agent,
            tools=agent_tools,
            handle_parsing_errors=True,
            verbose=False,
        )
        workflow = StateGraph(OverallState, input=InputState, output=OutputState)

        def run_agent_node(state: InputState):
            # "input" is from the State
            user_input = state["input"]
            # "input" is from the State
            result = agent_executor.invoke(
                {"input": user_input}, config={"callbacks": [self.opik_tracer]}
            )
            # "input", "output" are from the State
            return {"input": user_input, "output": result["output"]}

        workflow.add_node("agent", run_agent_node)
        workflow.set_entry_point("agent")
        workflow.set_finish_point("agent")
        self.graph = workflow.compile()

        # Setup the Opik tracker:
        self.opik_tracer = OpikTracer(
            project_name=self.optimizer.project_name,
            tags=self.optimizer.tags,
            graph=self.graph.get_graph(xray=True),
        )

    def llm_invoke(self, prompt):
        new_prompt = self.llm.invoke(prompt).content
        # Make sure it contains necessary fields:
        if "{input}" not in new_prompt:
            new_prompt += "\nQuestion: {input}"
        if "{agent_scratchpad}" not in new_prompt:
            new_prompt += "\nThought: {agent_scratchpad}"
        if "[{tool_names}]" not in new_prompt:
            new_prompt += "\nTool names: [{tool_names}]"
        if "{tools}" not in new_prompt:
            new_prompt += "\nTools: {tools}"
        return new_prompt

    def invoke(self, item: Dict[str, Any]) -> Dict[str, Any]:
        # "input" and "output" are Agent State fields
        # FIXME: need to map input_dataset_fields to correct state fields:
        messages = agent_config["chat-prompt"]["value"]
        state = {
            "input": item[key]
            for key in self.optimizer.task_config.input_dataset_fields
        }
        messages.append(state)
        # FIXME: allow messages
        result = self.graph.invoke(state)
        return {"output": result["output"]}


optimizer = OpikAgentOptimizer(
    agent_class=LangGraphAgent,
    project_name=project_name,
    tags=["langchain-agent"],
    task_config=task_config,
)

agent_config = {
    "chat-prompt": {"type": "chat", "value": []},
    "Wikipedia Search": {
        "type": "tool",
        "value": "Search wikipedia for abstracts. Gives a brief paragraph about a topic.",
        "function": search_wikipedia,
    },
    "system-prompt": {"type": "prompt", "value": prompt_template, "template": True},
}

agent = LangGraphAgent(optimizer, agent_config)
result = agent.invoke({"question": "Which is heavier: a newborn elephant, or a motor boat?"})
print(result)

optimizer.optimize_prompt(
    agent_config=agent_config,
    dataset=dataset,
    metric_config=metric_config,
    n_samples=10,
    num_threads=16,
)

# TODO: get the optimizer out of Agent
# 1. self.optimizer.project_name
# 2. self.optimizer.tags
# 3. self.optimizer.task_config.input_dataset_fields
