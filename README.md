# cc-mod-caffeinate ☕

A [Claude Code](https://claude.com/claude-code) mod that keeps your Mac's screen awake only while Claude is actively working. The screen can sleep again as soon as Claude finishes, or while it is waiting on you.

- **Holds only during active work.** It stops holding the screen while a permission dialog, an `AskUserQuestion` prompt or an MCP input prompt is waiting on you, and resumes once you answer.
- **Works across sessions.** Each session holds its own `caffeinate`, and macOS keeps the display on while any of them asks, so the screen sleeps only once no session is working.
- **Nothing to install or run.** It runs inside Claude Code as a function-hooks mod: no app, no `npx`, no admin rights, no background server.
- **Recovers from crashes.** Each hold is a `caffeinate -t 300` renewed while the turn runs, so a session that dies leaves no stray hold for more than 5 minutes.
- **Shows its state.** A ☕ appears in the status line while the screen is held.

Claude Code already runs `caffeinate -i` while it works, which stops the Mac from going to sleep but still lets the screen turn off. This mod adds `-d` to keep the display on as well.

## Install

At the prompt of a terminal session:

```
/plugin install cc-mod-caffeinate --marketplace williamchong/cc-mod-caffeinate
```

Answer `y` to add the marketplace, then choose a scope (user scope loads it in every session).

## Requirements

- macOS (uses `/usr/bin/caffeinate`)
- Claude Code with function-hooks mods (tested on 2.1.291). The mod API is early access and may change between releases.

## How it decides

| Claude is… | Screen |
| --- | --- |
| running a turn (thinking, calling tools) | held awake |
| showing a permission dialog, asking a question, or waiting on MCP input | released |
| done with the turn, or the session ended | released |

Claude Code has no event for "a permission prompt was answered", so holding resumes at the next sign of progress: the tool finishing, a denial, or the next model request. While a tool you just approved is running, the screen is not held. Your key press to approve resets the idle timer anyway.

To check it, run this while Claude is working:

```sh
pmset -g assertions | grep caffeinate
```

## Alternatives

- **Keeping the Mac awake with the lid closed:** see [jmslau/claude-caffeine](https://github.com/jmslau/claude-caffeine), a menu-bar app that uses `pmset disablesleep`.
- **Linux and Windows:** see [Ami3466/claude-awake](https://github.com/Ami3466/claude-awake).

## Development

Run it from a checkout:

```sh
claude --plugin-dir /path/to/cc-mod-caffeinate
```

To load it in every session, set `CLAUDE_CODE_PLUGIN_DIRS` to the checkout's path in the `env` block of `~/.claude/settings.json`. Saving a file reloads the mod in interactive sessions.

Check and test it:

```sh
claude plugin validate .
claude plugin test .
```

## License

[MIT](LICENSE)
