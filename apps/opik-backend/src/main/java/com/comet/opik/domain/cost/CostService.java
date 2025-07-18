package com.comet.opik.domain.cost;

import com.comet.opik.api.ModelCostData;
import com.comet.opik.utils.JsonUtils;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import lombok.extern.slf4j.Slf4j;

import javax.annotation.Nullable;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.math.BigDecimal;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.function.BiFunction;

@Slf4j
public class CostService {
    private static final char MODEL_PROVIDER_SEPARATOR = '/';
    private static final Map<String, ModelPrice> modelProviderPrices;
    private static final Map<String, String> PROVIDERS_MAPPING = Map.of(
            "openai", "openai",
            "vertex_ai-language-models", "google_vertexai",
            "gemini", "google_ai",
            "anthropic", "anthropic",
            "vertex_ai-anthropic_models", "anthropic_vertexai");
    private static final String PRICES_FILE = "model_prices_and_context_window.json";
    private static final Map<String, BiFunction<ModelPrice, Map<String, Integer>, BigDecimal>> PROVIDERS_CACHE_COST_CALCULATOR = Map
            .of("anthropic", SpanCostCalculator::textGenerationWithCacheCostAnthropic,
                    "openai", SpanCostCalculator::textGenerationWithCacheCostOpenAI);

    static {
        try {
            modelProviderPrices = Collections.unmodifiableMap(parseModelPrices());
        } catch (IOException e) {
            log.error("Failed to load model prices", e);
            throw new UncheckedIOException(e);
        }
    }

    private static final ModelPrice DEFAULT_COST = new ModelPrice(
            new BigDecimal("0"),
            new BigDecimal("0"),
            new BigDecimal("0"),
            new BigDecimal("0"),
            new BigDecimal("0"),
            new BigDecimal("0"),
            new BigDecimal("0"),
            (mp, usage) -> BigDecimal.ZERO);

    public static BigDecimal calculateCost(@Nullable String modelName, @Nullable String provider,
            @Nullable Map<String, Integer> usage, @Nullable JsonNode metadata) {
        ModelPrice modelPrice = Optional.ofNullable(modelName)
                .flatMap(mn -> Optional.ofNullable(provider).map(p -> createModelProviderKey(mn, p)))
                .map(modelProviderPrices::get)
                .orElse(DEFAULT_COST);

        BigDecimal estimatedCost = modelPrice.calculator().apply(modelPrice,
                Optional.ofNullable(usage).orElse(Map.of()));

        return estimatedCost.compareTo(BigDecimal.ZERO) > 0 ? estimatedCost : getCostFromMetadata(metadata);
    }

    public static BigDecimal getCostFromMetadata(JsonNode metadata) {
        return Optional.ofNullable(metadata)
                .map(md -> md.get("cost"))
                .map(cost -> Optional.ofNullable(cost.get("currency"))
                        .map(JsonNode::asText)
                        .filter("USD"::equals)
                        .map(currency -> cost.get("total_tokens"))
                        .map(JsonNode::decimalValue)
                        .orElse(BigDecimal.ZERO))
                .orElse(BigDecimal.ZERO);
    }

    private static Map<String, ModelPrice> parseModelPrices() throws IOException {
        Map<String, ModelCostData> modelCosts = JsonUtils.readJsonFile(PRICES_FILE, new TypeReference<>() {
        });
        if (modelCosts.isEmpty()) {
            throw new UncheckedIOException(new IOException("Failed to load model prices"));
        }

        Map<String, ModelPrice> parsedModelPrices = new HashMap<>();
        modelCosts.forEach((modelName, modelCost) -> {
            String provider = Optional.ofNullable(modelCost.litellmProvider()).orElse("");
            if (PROVIDERS_MAPPING.containsKey(provider)) {

                BigDecimal inputTextPrice = Optional.ofNullable(modelCost.inputTextCostPerToken()).map(BigDecimal::new)
                        .orElse(BigDecimal.ZERO);
                BigDecimal inputImagePrice = Optional.ofNullable(modelCost.inputImageCostPerImage())
                        .map(BigDecimal::new)
                        .orElse(BigDecimal.ZERO);
                BigDecimal inputAudioPrice = Optional.ofNullable(modelCost.inputAudioCostPerSecond())
                        .map(BigDecimal::new)
                        .orElse(BigDecimal.ZERO);
                BigDecimal inputVideoPrice = Optional.ofNullable(modelCost.inputVideoCostPerSecond())
                        .map(BigDecimal::new)
                        .orElse(BigDecimal.ZERO);
                BigDecimal outputPrice = Optional.ofNullable(modelCost.outputCostPerToken()).map(BigDecimal::new)
                        .orElse(BigDecimal.ZERO);
                BigDecimal cacheCreationInputTokenPrice = Optional.ofNullable(modelCost.cacheCreationInputTokenCost())
                        .map(BigDecimal::new)
                        .orElse(BigDecimal.ZERO);
                BigDecimal cacheReadInputTokenPrice = Optional.ofNullable(modelCost.cacheReadInputTokenCost())
                        .map(BigDecimal::new)
                        .orElse(BigDecimal.ZERO);

                BiFunction<ModelPrice, Map<String, Integer>, BigDecimal> genericMultimodalCalculator = (mp, usage) -> {
                    BigDecimal cost = BigDecimal.ZERO;
                    // Text cost
                    if (inputTextPrice.compareTo(BigDecimal.ZERO) > 0 || outputPrice.compareTo(BigDecimal.ZERO) > 0) {
                        cost = cost.add(SpanCostCalculator.textCost(mp, usage));
                    }
                    // Image cost
                    if (inputImagePrice.compareTo(BigDecimal.ZERO) > 0 && usage.containsKey("image_count")) {
                        cost = cost.add(SpanCostCalculator.imageCost(mp, usage));
                    }
                    // Audio cost
                    if (inputAudioPrice.compareTo(BigDecimal.ZERO) > 0 && usage.containsKey("audio_seconds")) {
                        cost = cost.add(SpanCostCalculator.audioCost(mp, usage));
                    }
                    // Video cost
                    if (inputVideoPrice.compareTo(BigDecimal.ZERO) > 0 && usage.containsKey("video_seconds")) {
                        cost = cost.add(SpanCostCalculator.videoCost(mp, usage));
                    }
                    // Cache cost
                    if (mp.cacheCreationInputTokenPrice().compareTo(BigDecimal.ZERO) > 0
                            || mp.cacheReadInputTokenPrice().compareTo(BigDecimal.ZERO) > 0) {
                        cost = cost.add(SpanCostCalculator.cacheCost(mp, usage));
                    }
                    return cost;
                };

                BiFunction<ModelPrice, Map<String, Integer>, BigDecimal> calculator;
                if (cacheCreationInputTokenPrice.compareTo(BigDecimal.ZERO) > 0
                        || cacheReadInputTokenPrice.compareTo(BigDecimal.ZERO) > 0) {
                    calculator = PROVIDERS_CACHE_COST_CALCULATOR.getOrDefault(provider, genericMultimodalCalculator);
                } else {
                    calculator = genericMultimodalCalculator;
                }

                parsedModelPrices.put(
                        createModelProviderKey(parseModelName(modelName), PROVIDERS_MAPPING.get(provider)),
                        new ModelPrice(inputTextPrice, inputImagePrice, inputAudioPrice, inputVideoPrice, outputPrice,
                                cacheCreationInputTokenPrice, cacheReadInputTokenPrice, calculator));
            }
        });

        return parsedModelPrices;
    }

    private static String parseModelName(String modelName) {
        int prefixIndex = modelName.indexOf('/');
        return prefixIndex == -1 ? modelName : modelName.substring(prefixIndex + 1);
    }

    private static String createModelProviderKey(String modelName, String provider) {
        return modelName + MODEL_PROVIDER_SEPARATOR + provider;
    }
}
