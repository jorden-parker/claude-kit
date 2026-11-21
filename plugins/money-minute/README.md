# money-minute

ADHD-friendly money check-ins on your [Emma](https://emma-app.com) data. Short, shame-free, and always ending in one next step.

## Why it looks like this

| ADHD money problem                               | What the plugin does                                                                                                   |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Avoiding the bank app because it feels bad       | `/money` is a one-minute check-in: three numbers, one next step, no lectures                                           |
| Out of sight, out of mind                        | The status line shows days since you last looked                                                                       |
| Forgotten bills, unused subscriptions, late fees | `/money bills` lists the next 14 days, flags what the balance won't cover, price rises and subscriptions you don't use |
| Impulse buys                                     | `/money pause <item>` parks it for 48 hours; `/money` brings it back once the wait is up                               |
| Budgets that fall apart                          | `/money week` shows each budget as a bar, a win first, then one step                                                   |

## Commands

```
/money                     one-minute check-in
/money bills               bills and subscriptions due in the next 14 days
/money week                this week's spending against your budgets
/money pause <item>        park an impulse buy for 48 hours
/money pause               list parked buys
/money pause done <item>   remove a parked buy once you've decided
```

## Setup

1. Connect Emma at claude.ai: Settings, Connectors, Emma. Its tools show up as `mcp__claude_ai_Emma_App__*`
2. `/plugin install money-minute@claude-kit`
3. Run `/money`

- Emma access is read-only: the plugin never moves money
- Emma gives information, not financial advice, and the prompts keep to that
- Parked buys and the last check-in time live in the plugin's store on this machine
