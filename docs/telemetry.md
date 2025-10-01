# Observability with OpenTelemetry

Learn how to enable and setup OpenTelemetry for Gemini CLI.

- [Observability with OpenTelemetry](#observability-with-opentelemetry)
  - [Key Benefits](#key-benefits)
  - [OpenTelemetry Integration](#opentelemetry-integration)
  - [Configuration](#configuration)
  - [Google Cloud Telemetry](#google-cloud-telemetry)
    - [Prerequisites](#prerequisites)
    - [Direct Export (Recommended)](#direct-export-recommended)
    - [Collector-Based Export (Advanced)](#collector-based-export-advanced)
  - [Local Telemetry](#local-telemetry)
    - [File-based Output (Recommended)](#file-based-output-recommended)
    - [Collector-Based Export (Advanced)](#collector-based-export-advanced-1)
  - [Logs and Metrics](#logs-and-metrics)
    - [Logs](#logs)
    - [Metrics](#metrics)
      - [Custom](#custom)
      - [GenAI Semantic Convention](#genai-semantic-convention)

## Key Benefits

- **🔍 Usage Analytics**: Understand interaction patterns and feature adoption
  across your team
- **⚡ Performance Monitoring**: Track response times, token consumption, and
  resource utilization
- **🐛 Real-time Debugging**: Identify bottlenecks, failures, and error patterns
  as they occur
- **📊 Workflow Optimization**: Make informed decisions to improve
  configurations and processes
- **🏢 Enterprise Governance**: Monitor usage across teams, track costs, ensure
  compliance, and integrate with existing monitoring infrastructure

## OpenTelemetry Integration

Built on **[OpenTelemetry]** — the vendor-neutral, industry-standard
observability framework — Gemini CLI's observability system provides:

- **Universal Compatibility**: Export to any OpenTelemetry backend (Google
  Cloud, Jaeger, Prometheus, Datadog, etc.)
- **Standardized Data**: Use consistent formats and collection methods across
  your toolchain
- **Future-Proof Integration**: Connect with existing and future observability
  infrastructure
- **No Vendor Lock-in**: Switch between backends without changing your
  instrumentation

[OpenTelemetry]: https://opentelemetry.io/

## Configuration

All telemetry behavior is controlled through your `.gemini/settings.json` file.
These settings can be overridden by environment variables or CLI flags.

| Setting        | Environment Variable             | CLI Flag                                                 | Description                                       | Values            | Default                 |
| -------------- | -------------------------------- | -------------------------------------------------------- | ------------------------------------------------- | ----------------- | ----------------------- |
| `enabled`      | `GEMINI_TELEMETRY_ENABLED`       | `--telemetry` / `--no-telemetry`                         | Enable or disable telemetry                       | `true`/`false`    | `false`                 |
| `target`       | `GEMINI_TELEMETRY_TARGET`        | `--telemetry-target <local\|gcp>`                        | Where to send telemetry data                      | `"gcp"`/`"local"` | `"local"`               |
| `otlpEndpoint` | `GEMINI_TELEMETRY_OTLP_ENDPOINT` | `--telemetry-otlp-endpoint <URL>`                        | OTLP collector endpoint                           | URL string        | `http://localhost:4317` |
| `otlpProtocol` | `GEMINI_TELEMETRY_OTLP_PROTOCOL` | `--telemetry-otlp-protocol <grpc\|http>`                 | OTLP transport protocol                           | `"grpc"`/`"http"` | `"grpc"`                |
| `outfile`      | `GEMINI_TELEMETRY_OUTFILE`       | `--telemetry-outfile <path>`                             | Save telemetry to file (overrides `otlpEndpoint`) | file path         | -                       |
| `logPrompts`   | `GEMINI_TELEMETRY_LOG_PROMPTS`   | `--telemetry-log-prompts` / `--no-telemetry-log-prompts` | Include prompts in telemetry logs                 | `true`/`false`    | `true`                  |
| `useCollector` | `GEMINI_TELEMETRY_USE_COLLECTOR` | -                                                        | Use external OTLP collector (advanced)            | `true`/`false`    | `false`                 |

**Note on boolean environment variables:** For the boolean settings (`enabled`,
`logPrompts`, `useCollector`), setting the corresponding environment variable to
`true` or `1` will enable the feature. Any other value will disable it.

For detailed information about all configuration options, see the
[Configuration Guide](./cli/configuration.md).

## Google Cloud Telemetry

### Prerequisites

Before using either method below, complete these steps:

1. Set your Google Cloud project ID:
   - For telemetry in a separate project from inference:
     ```bash
     export OTLP_GOOGLE_CLOUD_PROJECT="your-telemetry-project-id"
     ```
   - For telemetry in the same project as inference:
     ```bash
     export GOOGLE_CLOUD_PROJECT="your-project-id"
     ```

2. Authenticate with Google Cloud:
   - If using a user account:
     ```bash
     gcloud auth application-default login
     ```
   - If using a service account:
     ```bash
     export GOOGLE_APPLICATION_CREDENTIALS="/path/to/your/service-account.json"
     ```
3. Make sure your account or service account has these IAM roles:
   - Cloud Trace Agent
   - Monitoring Metric Writer
   - Logs Writer

4. Enable the required Google Cloud APIs (if not already enabled):
   ```bash
   gcloud services enable \
     cloudtrace.googleapis.com \
     monitoring.googleapis.com \
     logging.googleapis.com \
     --project="$OTLP_GOOGLE_CLOUD_PROJECT"
   ```

### Direct Export (Recommended)

Sends telemetry directly to Google Cloud services. No collector needed.

1. Enable telemetry in your `.gemini/settings.json`:
   ```json
   {
     "telemetry": {
       "enabled": true,
       "target": "gcp"
     }
   }
   ```
2. Run Gemini CLI and send prompts.
3. View logs and metrics:
   - Open the Google Cloud Console in your browser after sending prompts:
     - Logs: https://console.cloud.google.com/logs/
     - Metrics: https://console.cloud.google.com/monitoring/metrics-explorer
     - Traces: https://console.cloud.google.com/traces/list

### Collector-Based Export (Advanced)

For custom processing, filtering, or routing, use an OpenTelemetry collector to
forward data to Google Cloud.

1. Configure your `.gemini/settings.json`:
   ```json
   {
     "telemetry": {
       "enabled": true,
       "target": "gcp",
       "useCollector": true
     }
   }
   ```
2. Run the automation script:
   ```bash
   npm run telemetry -- --target=gcp
   ```
   This will:
   - Start a local OTEL collector that forwards to Google Cloud
   - Configure your workspace
   - Provide links to view traces, metrics, and logs in Google Cloud Console
   - Save collector logs to `~/.gemini/tmp/<projectHash>/otel/collector-gcp.log`
   - Stop collector on exit (e.g. `Ctrl+C`)
3. Run Gemini CLI and send prompts.
4. View logs and metrics:
   - Open the Google Cloud Console in your browser after sending prompts:
     - Logs: https://console.cloud.google.com/logs/
     - Metrics: https://console.cloud.google.com/monitoring/metrics-explorer
     - Traces: https://console.cloud.google.com/traces/list
   - Open `~/.gemini/tmp/<projectHash>/otel/collector-gcp.log` to view local
     collector logs.

## Local Telemetry

For local development and debugging, you can capture telemetry data locally:

### File-based Output (Recommended)

1. Enable telemetry in your `.gemini/settings.json`:
   ```json
   {
     "telemetry": {
       "enabled": true,
       "target": "local",
       "otlpEndpoint": "",
       "outfile": ".gemini/telemetry.log"
     }
   }
   ```
2. Run Gemini CLI and send prompts.
3. View logs and metrics in the specified file (e.g., `.gemini/telemetry.log`).

### Collector-Based Export (Advanced)

1. Run the automation script:
   ```bash
   npm run telemetry -- --target=local
   ```
   This will:
   - Download and start Jaeger and OTEL collector
   - Configure your workspace for local telemetry
   - Provide a Jaeger UI at http://localhost:16686
   - Save logs/metrics to `~/.gemini/tmp/<projectHash>/otel/collector.log`
   - Stop collector on exit (e.g. `Ctrl+C`)
2. Run Gemini CLI and send prompts.
3. View traces at http://localhost:16686 and logs/metrics in the collector log
   file.

## Logs and Metrics

The following section describes the structure of logs and metrics generated for
Gemini CLI.

- A `sessionId` is included as a common attribute on all logs and metrics.

### Logs

Logs are timestamped records of specific events. The following events are logged
for Gemini CLI:

- `gemini_cli.config`: This event occurs once at startup with the CLI's
  configuration.
  - **Attributes**:
    - `model` (string)
    - `embedding_model` (string)
    - `sandbox_enabled` (boolean)
    - `core_tools_enabled` (string)
    - `approval_mode` (string)
    - `api_key_enabled` (boolean)
    - `vertex_ai_enabled` (boolean)
    - `debug_enabled` (boolean)
    - `telemetry_enabled` (boolean)
    - `telemetry_log_user_prompts_enabled` (boolean)
    - `file_filtering_respect_git_ignore` (boolean)
    - `mcp_servers` (string)
    - `mcp_servers_count` (int)
    - `mcp_tools` (string)
    - `mcp_tools_count` (int)
    - `output_format` (string: "text" or "json")

- `gemini_cli.user_prompt`: This event occurs when a user submits a prompt.
  - **Attributes**:
    - `prompt_length` (int)
    - `prompt_id` (string)
    - `prompt` (string, this attribute is excluded if `log_prompts_enabled` is
      configured to be `false`)
    - `auth_type` (string)

- `gemini_cli.tool_call`: This event occurs for each function call.
  - **Attributes**:
    - `function_name`
    - `function_args`
    - `duration_ms`
    - `success` (boolean)
    - `decision` (string: "accept", "reject", "auto_accept", or "modify", if
      applicable)
    - `error` (if applicable)
    - `error_type` (if applicable)
    - `prompt_id` (string)
    - `tool_type` (string: "native" or "mcp")
    - `content_length` (int, if applicable)
    - `mcp_server_name` (string, if applicable)
    - `metadata` (if applicable, dictionary of string -> any)

- `gemini_cli.file_operation`: This event occurs for each file operation.
  - **Attributes**:
    - `tool_name` (string)
    - `operation` (string: "create", "read", "update")
    - `lines` (int, if applicable)
    - `mimetype` (string, if applicable)
    - `extension` (string, if applicable)
    - `programming_language` (string, if applicable)

- `gemini_cli.api_request`: This event occurs when making a request to Gemini API.
  - **Attributes**:
    - `model`
    - `prompt_id` (string)
    - `request_text` (if applicable)

- `gemini_cli.api_error`: This event occurs if the API request fails.
  - **Attributes**:
    - `model`
    - `error`
    - `error_type`
    - `status_code`
    - `duration_ms`
    - `prompt_id` (string)
    - `auth_type`

- `gemini_cli.api_response`: This event occurs upon receiving a response from Gemini API.
  - **Attributes**:
    - `model`
    - `status_code`
    - `duration_ms`
    - `error` (optional)
    - `input_token_count`
    - `output_token_count`
    - `cached_content_token_count`
    - `thoughts_token_count`
    - `tool_token_count`
    - `total_token_count`
    - `response_text` (if applicable)
    - `prompt_id`
    - `auth_type`

- `gemini_cli.tool_output_truncated`: This event occurs when the output of a tool call is too large and gets truncated.
  - **Attributes**:
    - `tool_name` (string)
    - `original_content_length` (int)
    - `truncated_content_length` (int)
    - `threshold` (int)
    - `lines` (int)
    - `prompt_id` (string)

- `gemini_cli.malformed_json_response`: This event occurs when a `generateJson` response from Gemini API cannot be parsed as a json.
  - **Attributes**:
    - `model`

- `gemini_cli.flash_fallback`: This event occurs when Gemini CLI switches to flash as fallback.
  - **Attributes**:
    - `auth_type`

- `gemini_cli.ripgrep_fallback`: This event occurs when Gemini CLI switches to grep as fallback.
  - **Attributes**:
    - `error` (string, if applicable)

- `gemini_cli.next_speaker_check`: This event occurs when the CLI checks who the next speaker should be.
  - **Attributes**:
    - `next_speaker` (string)

- `gemini_cli.ide_connection`: This event occurs when the CLI connects to an IDE.
  - **Attributes**:
    - `connection_type` (string)

- `gemini_cli.conversation_finished`: This event occurs when a conversation is finished.
  - **Attributes**:
    - `reason` (string)

- `gemini_cli.chat_compression`: This event occurs when the chat history is compressed.
  - **Attributes**:
    - `tokens_before` (int)
    - `tokens_after` (int)

- `gemini_cli.invalid_chunk`: This event occurs when an invalid chunk is received from the stream.
  - **Attributes**:
    - `error_message` (string)

- `gemini_cli.chat.content_retry`: This event occurs when there is a content retry.
  - **Attributes**:
    - `attempt_number` (int)
    - `error_type` (string)

- `gemini_cli.chat.content_retry_failure`: This event occurs when all content retries fail.
  - **Attributes**:
    - `total_attempts` (int)

- `gemini_cli.slash_command.model`: This event occurs when a model slash command is executed.
  - **Attributes**:
    - `model_name` (string)

- `gemini_cli.model_routing`: This event occurs when a model routing decision is made.
  - **Attributes**:
    - `decision_model` (string)
    - `decision_source` (string)

- `gemini_cli.slash_command`: This event occurs when a user executes a slash command.
  - **Attributes**:
    - `command` (string)
    - `subcommand` (string, if applicable)

- `gemini_cli.extension_install`: This event occurs when an extension is installed
  - **Attributes**:
    - `extension_name` (string)
    - `extension_version` (string)
    - `extension_source` (string)
    - `status` (string)

- `gemini_cli.extension_uninstall`: This event occurs when an extension is uninstalled
  - **Attributes**:
    - `extension_name` (string)

- `gemini_cli.extension_enable`: This event occurs when an extension is enabled
  - **Attributes**:
    - `extension_name` (string)

- `gemini_cli.extension_disable`: This event occurs when an extension is disabled
  - **Attributes**:
    - `extension_name` (string)

- `gemini_cli.startup.performance`: This event occurs during CLI startup to track performance metrics
  - **Attributes**:
    - `startup_duration_ms` (int)
    - `memory_usage_mb` (int)

- `gemini_cli.memory.usage`: This event occurs to track memory usage patterns
  - **Attributes**:
    - `memory_used_mb` (int)
    - `memory_peak_mb` (int)

- `gemini_cli.performance.baseline`: This event occurs when establishing performance baselines
  - **Attributes**:
    - `baseline_type` (string)
    - `baseline_value` (number)

- `gemini_cli.performance.regression`: This event occurs when performance regressions are detected
  - **Attributes**:
    - `regression_type` (string)
    - `regression_percentage` (number)
    - `current_value` (number)
    - `baseline_value` (number)

### Metrics

Metrics are numerical measurements of behavior over time.

#### Custom

- `gemini_cli.session.count` (Counter, Int): Incremented once per CLI startup.

- `gemini_cli.tool.call.count` (Counter, Int): Counts tool calls.
  - **Attributes**:
    - `function_name`
    - `success` (boolean)
    - `decision` (string: "accept", "reject", or "modify", if applicable)
    - `tool_type` (string: "mcp", or "native", if applicable)

- `gemini_cli.tool.call.latency` (Histogram, ms): Measures tool call latency.
  - **Attributes**:
    - `function_name`

- `gemini_cli.api.request.count` (Counter, Int): Counts all API requests.
  - **Attributes**:
    - `model`
    - `status_code`
    - `error_type` (if applicable)

- `gemini_cli.api.request.latency` (Histogram, ms): Measures API request latency.
  - **Attributes**:
    - `model`
  - **Note**: This metric overlaps with `gen_ai.client.operation.duration` below
    that's compliant with GenAI Semantic Conventions.

- `gemini_cli.token.usage` (Counter, Int): Counts the number of tokens used.
  - **Attributes**:
    - `model`
    - `type` (string: "input", "output", "thought", "cache", or "tool")
  - **Note**: This metric overlaps with `gen_ai.client.token.usage` below for
    `input`/`output` token types that's compliant with GenAI Semantic
    Conventions.

- `gemini_cli.file.operation.count` (Counter, Int): Counts file operations.
  - **Attributes**:
    - `operation` (string: "create", "read", "update"): The type of file operation.
    - `lines` (Int, if applicable): Number of lines in the file.
    - `mimetype` (string, if applicable): Mimetype of the file.
    - `extension` (string, if applicable): File extension of the file.
    - `programming_language` (string, if applicable): The programming language of the file.

- `gemini_cli.chat_compression` (Counter, Int): Counts chat compression operations
  - **Attributes**:
    - `tokens_before`: (Int): Number of tokens in context prior to compression
    - `tokens_after`: (Int): Number of tokens in context after compression

- `gemini_cli.chat.invalid_chunk.count` (Counter, Int): Counts invalid chunks received from a stream.

- `gemini_cli.chat.content_retry.count` (Counter, Int): Counts retries due to content errors.

- `gemini_cli.chat.content_retry_failure.count` (Counter, Int): Counts occurrences of all content retries failing.

- `gemini_cli.model_routing.latency` (Histogram, ms): Latency of model routing decisions.
  - **Attributes**:
    - `routing.decision_model` (string)
    - `routing.decision_source` (string)

- `gemini_cli.model_routing.failure.count` (Counter, Int): Counts model routing failures.
  - **Attributes**:
    - `routing.decision_source` (string)
    - `routing.error_message` (string)

- `gemini_cli.slash_command.model.call_count` (Counter, Int): Counts model slash command calls.
  - **Attributes**:
    - `slash_command.model.model_name` (string)

#### GenAI Semantic Convention

The following metrics comply with [OpenTelemetry GenAI semantic conventions]
for standardized observability across GenAI applications:

- `gen_ai.client.token.usage` (Histogram, token): Number of input and output tokens used per operation.
  - **Attributes**:
    - `gen_ai.operation.name` (string): The operation type (e.g., "generate_content", "chat")
    - `gen_ai.provider.name` (string): The GenAI provider ("gcp.gen_ai" or "gcp.vertex_ai")
    - `gen_ai.token.type` (string): The token type ("input" or "output")
    - `gen_ai.request.model` (string, optional): The model name used for the request
    - `gen_ai.response.model` (string, optional): The model name that generated the response
    - `server.address` (string, optional): GenAI server address
    - `server.port` (int, optional): GenAI server port

- `gen_ai.client.operation.duration` (Histogram, s): GenAI operation duration in seconds.
  - **Attributes**:
    - `gen_ai.operation.name` (string): The operation type (e.g., "generate_content", "chat")
    - `gen_ai.provider.name` (string): The GenAI provider ("gcp.gen_ai" or "gcp.vertex_ai")
    - `gen_ai.request.model` (string, optional): The model name used for the request
    - `gen_ai.response.model` (string, optional): The model name that generated the response
    - `server.address` (string, optional): GenAI server address
    - `server.port` (int, optional): GenAI server port
    - `error.type` (string, optional): Error type if the operation failed

[OpenTelemetry GenAI semantic conventions]: https://github.com/open-telemetry/semantic-conventions/blob/main/docs/gen-ai/gen-ai-metrics.md
