# Sentinel

Autonomous options spread-trading bot. Paper mode first, with a per-strategy switch to live.

- Dean sets the ticker list. Sentinel chooses the strategy, entry timing and exit for each ticker.
- v1 strategies: vertical credit spreads and iron condors.
- Account base for sizing and limits: $10k net liquidation.
- Alerts by SMS and email.

Requirements (living doc): https://claude.ai/artifact/JDamfqjDPGGeXzjZ8Nynyr

## Status

Scaffold only. No trading code yet. Build order is in the requirements doc (tickets SENT-001 to SENT-011).

## Layout

- `scripts/`: one-off tools, for example `sentinel_data_check.py` (read-only check of tastytrade market metrics).
- `docs/`: decisions and notes.
