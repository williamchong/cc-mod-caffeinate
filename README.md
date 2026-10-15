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
| done with the turn, but a background subagent, workflow or Bash job is still running | held awake |
| done with the turn, with only a dev server, watcher or `Monitor` left in the background | released |
| done with the turn, or the session ended | released |

Background work is read from the list Claude Code hands its `Stop` hook when a turn ends. A finished background task wakes the session with a new turn, so the hold is checked again each time one finishes. A background Bash command counts as a server and is not held when it looks like one that runs until it is stopped: `dev`, `serve`, `server`, `start`, `watch`, `preview`, `up`, `runserver`, `http.server`, `nodemon`, `--watch` or `tail -f`. A server that slips past this list, or a job killed without waking the session, is let go after `backgroundHoldMinutes`.

Claude Code has no event for "a permission prompt was answered", so holding resumes at the next sign of progress: the tool finishing, a denial, or the next model request. While a tool you just approved is running, the screen is not held. Your key press to approve resets the idle timer anyway.

To check it, run this while Claude is working:

```sh
pmset -g assertions | grep caffeinate
```

## Options

| Option | Default | Effect |
| --- | --- | --- |
| `keepAwakeLidClosed` | `false` | Also passes `-s` to `caffeinate`, so Claude keeps working when you close the lid. **AC power only:** on battery, closing the lid still puts the Mac to sleep. |
| `showStatus` | `true` | Pins a ☕ under the prompt while the screen is held. Turn it off to free the line. |
| `backgroundHoldMinutes` | `60` | Releases the screen this many minutes after a turn ends, even if background jobs still run. It is checked as the 5-minute hold renews, so it fires up to 5 minutes late. `0` holds until they finish. |

Set it on the plugin's config screen in `/plugin`. When you run the mod from a checkout (`--plugin-dir` or `CLAUDE_CODE_PLUGIN_DIRS`), set it under `pluginConfigs` in `~/.claude/settings.json` instead:

```json
"pluginConfigs": {
  "cc-mod-caffeinate": { "options": { "keepAwakeLidClosed": true } }
}
```

The same rules apply with the lid closed: the Mac is released while Claude waits on you and when the turn ends, so it sleeps once there is nothing left to do. Even so, avoid putting a Mac that is plugged in and working into a bag.

## Why not just `caffeinate -w`?

A one-liner keeps the screen on for as long as Claude Code is open:

```sh
caffeinate -d -w $(pgrep -n claude)
```

That holds for the whole session, not for the turn. A session left open overnight at an idle prompt keeps the screen on all night, which is the same as turning display sleep off.

| | `caffeinate -d -w` | This mod |
| --- | --- | --- |
| Screen held while Claude runs a turn | yes | yes |
| Screen can sleep when the turn ends | no | yes |
| Screen can sleep while Claude waits on you | no | yes |
| Several sessions | one command per session, run by hand | automatic |
| Shows when the screen is held | no | ☕ in the status line |

Two shell hooks (`UserPromptSubmit` to start `caffeinate`, `Stop` to kill it) get closer, but they keep holding during permission dialogs and questions, and you manage the pid files and stale holds from crashed sessions yourself.

If you quit Claude Code whenever you step away, the one-liner is enough.

## Alternatives

- **Keeping the Mac awake with the lid closed on battery:** see [jmslau/claude-caffeine](https://github.com/jmslau/claude-caffeine), a menu-bar app that uses `pmset disablesleep`.
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
