# Opik Agent Optimizer

[![PyPI version](https://img.shields.io/pypi/v/opik-optimizer.svg)](https://pypi.org/project/opik-optimizer/)
[![Python versions](https://img.shields.io/pypi/pyversions/opik-optimizer.svg)](https://pypi.org/project/opik-optimizer/)
[![Downloads](https://static.pepy.tech/badge/opik-optimizer)](https://pepy.tech/project/opik-optimizer)
[![License](https://img.shields.io/github/license/comet-ml/opik)](https://github.com/comet-ml/opik/blob/main/LICENSE)

The Opik Agent Optimizer refines your prompts to achieve better performance from your Large Language Models (LLMs). It supports a variety of optimization algorithms, including:

* EvolutionaryOptimizer
* FewShotBayesianOptimizer
* MetaPromptOptimizer
* MiproOptimizer

Opik Optimizer is a component of the [Opik platform](https://github.com/comet-ml/opik), an open-source LLM evaluation platform by Comet.
For more information about the broader Opik ecosystem, visit our [Website](https://www.comet.com/site/products/opik/) or [Documentation](https://www.comet.com/docs/opik/).

## Quickstart

Explore Opik Optimizer's capabilities with our interactive notebook:

<a href="https://colab.research.google.com/github/comet-ml/opik/blob/main/sdks/opik_optimizer/notebooks/OpikOptimizerIntro.ipynb">
  <img src="https://colab.research.google.com/assets/colab-badge.svg" alt="Open in Colab"/>
</a>

## Setup

To get started with Opik Optimizer, follow these steps:

1.  **Install the package:**
    ```bash
    # using pip
    pip install opik-optimizer

    # using uv (faster)
    uv pip install opik-optimizer
    ```

2.  **Configure Opik (Optional, for advanced features):**
    If you plan to log optimization experiments to Comet or use Opik Datasets, you'll need to configure the Opik client:
    ```bash
    # Install the main Opik CLI (if not already installed)
    pip install opik

    # Configure your Comet API key and workspace
    opik configure
    # When prompted, enter your Opik API key and workspace details.
    ```
    Using Opik with Comet allows you to track your optimization runs, compare results, and manage datasets seamlessly.

3.  **Set up LLM Provider API Keys:**
    Ensure your environment variables are set for the LLM(s) you intend to use. For example, for OpenAI models:
    ```bash
    export OPENAI_API_KEY="your_openai_api_key"
    ```
    The optimizer utilizes LiteLLM, so you can configure keys for various providers as per LiteLLM's documentation.

You'll typically need:

*   An LLM model name (e.g., "gpt-4o-mini", "claude-3-haiku-20240307").
*   An [Opik Dataset](https://www.comet.com/docs/opik/evaluation/manage_datasets/) (or a compatible local dataset/data generator).
*   An [Opik Metric](https://www.comet.com/docs/opik/evaluation/metrics/overview/) (or a custom evaluation function).
*   A starting prompt (template string).

## Example

Here's a brief example of how to use the `FewShotBayesianOptimizer`. We'll use a sample dataset provided by Opik.

Available sample datasets for testing:
*   `"tiny-test"`
*   `"halu-eval-300"`
*   `"hotpot-300"`

```python
from opik.evaluation.metrics import LevenshteinRatio
from opik_optimizer import FewShotBayesianOptimizer, ChatPrompt
from opik_optimizer.datasets import hotpot_300

# Load a sample dataset
hot_pot_dataset = hotpot_300()

project_name = "optimize-few-shot-bayesian-hotpot" # For Comet logging

# Define the instruction for your chat prompt.
# Input parameters from dataset examples will be interpolated into the full prompt.
prompt = ChatPrompt(
    project_name=project_name,
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "{question}"}
    ]
)

optimizer = FewShotBayesianOptimizer(
    model="gpt-4o-mini", # LiteLLM name to use for generation and optimization
    min_examples=3,      # Min few-shot examples
    max_examples=8,      # Max few-shot examples
    n_threads=16,        # Parallel threads for evaluation
    seed=42,
)

def levenshtein_ratio(dataset_item, llm_output):
    return LevenshteinRatio().score(reference=dataset_item["answer"], output=llm_output)

# Run the optimization
result = optimizer.optimize_prompt(
    prompt=prompt,
    dataset=hot_pot_dataset,
    metric=levenshtein_ratio,
    n_trials=10,   # Number of optimization trials
    n_samples=150, # Number of dataset samples for evaluation per trial
)

# Display the best prompt and its score
result.display()
```
The `result` object contains the optimized prompt, evaluation scores, and other details from the optimization process. If `project_name` is provided and Opik is configured, results will also be logged to your Comet workspace.

## Development

To contribute or use the Opik Optimizer from source:

1.  **Clone the Opik repository:**
    ```bash
    git clone git@github.com:comet-ml/opik.git
    ```
2.  **Navigate to the optimizer's directory:**
    ```bash
    cd opik/sdks/opik_optimizer  # Adjust 'opik' if you cloned into a different folder name
    ```
3.  **Install in editable mode (with development dependencies):**
    ```bash
    pip install -e .[dev]
    ```
    The `[dev]` extra installs dependencies useful for development, such as `pytest`.

## Requirements

- Python `>=3.9,<3.13`
- Opik API key (recommended for full functionality, configure via `opik configure`)
- API key for your chosen LLM provider (e.g., OpenAI, Anthropic, Gemini), configured as per LiteLLM guidelines.
