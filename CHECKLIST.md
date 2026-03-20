# CHECKLIST

## Phase 1: Minimal Skeleton

- Create MCP client wrapper around `bnbchain-mcp`
- Load and normalize available tool catalog
- Build a single CLI entry for one swap request

Done when:

- the demo can accept one text input
- the tool catalog is visible to the skill
- no write path is enabled by default

Manual check:

- run the CLI
- confirm it can connect to MCP and print a structured planning result shell

## Phase 2: Intent And Follow-Up

- Implement swap-only intent extraction
- Support unknown fields
- Add follow-up loop for missing amount and similar blockers
- Use balance context in follow-up when available

Done when:

- `Swap USDT to BNB` causes a follow-up instead of a hard failure
- the skill can continue after the user answers the question

Manual check:

- input: `Swap USDT to BNB with low MEV risk`
- expect: amount follow-up

## Phase 3: Route And Liquidity Reasoning

- Add liquidity discovery calls
- Add route candidate generation
- Add price impact comparison
- Add best price vs best execution reasoning

Done when:

- output includes at least 2 route candidates
- output explains why a better quote may still be rejected

Manual check:

- input: `Swap 100 USDT to BNB with low MEV risk`
- expect: route alternatives and rejection reasons

## Phase 4: MEV And Submission Reasoning

- Add MEV risk assessment
- Add submission path candidates
- Add public vs private tradeoff explanation
- Surface builder-aware recommendation when applicable

Done when:

- output contains explicit MEV reasoning
- output contains explicit submission recommendation

Manual check:

- input: `Swap 100 USDT to BNB with low MEV risk`
- expect: private path preference or explicit public-path warning

## Phase 5: Payload And Guardrails

- Add payload candidates
- Add simulation requirement
- Add slippage and deadline guardrails
- Add stale quote protection notes

Done when:

- output contains payload shape and guardrails
- no plan is emitted without guardrails

Manual check:

- input: `Swap 100 USDT to BNB with low MEV risk`
- expect: payload + guardrails + final recommendation

## Phase 6: Demo Polish

- Ensure markdown summary + JSON output
- Ensure recommendation and alternatives are clearly separated
- Ensure optional submit is visually secondary

Done when:

- the final output is usable in a talk demo without extra explanation

Manual check:

- verify the output sections appear in this order:
  - intent
  - liquidity / route
  - price impact
  - MEV risk
  - payload
  - guardrails
  - submission strategy
  - final recommendation

## Red Flags

Stop and revisit the direction if:

- transfer logic becomes the main story
- submit logic becomes the main story
- the output hides alternatives
- the skill stops asking follow-up questions and silently invents values
- the result looks like a generic agent answer instead of a swap-planning explanation
