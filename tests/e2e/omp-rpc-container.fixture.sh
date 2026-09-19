#!/bin/sh
set -eu

prompts=0
pending=""

response() {
  printf '{"type":"response","id":"%s","command":"%s","success":true,"data":%s}\n' \
    "$1" "$2" "$3"
}

printf '%s\n' '{"type":"ready","protocolVersion":1,"supportedProtocolVersions":[1]}'

while IFS= read -r line; do
  request_id="$(printf '%s' "$line" | sed -n -e 's/^{"id":"\([^"]*\)".*/\1/p' -e 's/^{"type":"[^"]*","id":"\([^"]*\)".*/\1/p')"
  request_type="$(printf '%s' "$line" | sed -n -e 's/^{"id":"[^"]*","type":"\([^"]*\)".*/\1/p' -e 's/^{"type":"\([^"]*\)".*/\1/p')"
  case "$request_type" in
    get_state)
      response "$request_id" "$request_type" \
        '{"sessionId":"omp-contained","model":{"provider":"code-nest-openai","id":"gpt-5.6-luna"}}'
      ;;
    set_host_tools)
      response "$request_id" "$request_type" '{}'
      ;;
    get_session_stats)
      response "$request_id" "$request_type" \
        "{\"tokens\":{\"input\":$((prompts * 9)),\"output\":$((prompts * 5))}}"
      ;;
    get_last_assistant_text)
      response "$request_id" "$request_type" '{"text":"Completed isolated proposal."}'
      ;;
    prompt)
      prompts=$((prompts + 1))
      printf 'proposal from %s\n' "$HOSTNAME" > "proposal-$HOSTNAME.txt"
      git add -- "proposal-$HOSTNAME.txt"
      git commit --quiet -m "Add proposal from $HOSTNAME"
      response "$request_id" "$request_type" '{"agentInvoked":true}'
      printf '%s\n' '{"type":"tool_execution_start","toolCallId":"write-1","toolName":"write","args":{}}'
      printf '%s\n' '{"type":"tool_execution_end","toolCallId":"write-1","toolName":"write","result":{},"isError":false}'
      pending="rationale"
      printf '%s\n' '{"type":"host_tool_call","id":"host-rationale","toolCallId":"rationale-1","toolName":"code_nest_submit_rationale","arguments":{"body":"I prepared the smallest isolated proposal for review."}}'
      ;;
    host_tool_result)
      if [ "$pending" = "rationale" ]; then
        pending="memory"
        printf '%s\n' "{\"type\":\"host_tool_call\",\"id\":\"host-memory\",\"toolCallId\":\"memory-1\",\"toolName\":\"code_nest_update_memory\",\"arguments\":{\"reason\":\"agent_consolidation\",\"summary\":\"Proposal is ready.\",\"content\":\"$HOSTNAME isolated proposal is committed and ready for Town Hall.\"}}"
      elif [ "$pending" = "memory" ]; then
        pending="message"
        printf '%s\n' "{\"type\":\"host_tool_call\",\"id\":\"host-message\",\"toolCallId\":\"message-1\",\"toolName\":\"code_nest_submit_command\",\"arguments\":{\"command\":{\"type\":\"message.publish\",\"body\":\"$HOSTNAME proposal is ready for review.\"}}}"
      elif [ "$pending" = "message" ]; then
        pending=""
        printf '%s\n' '{"type":"agent_end","messages":[{"role":"assistant","stopReason":"stop"}]}'
      fi
      ;;
  esac
done
