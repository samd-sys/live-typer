# Live Typer

Live Typer is a Visual Studio Code extension that types clipboard content character-by-character with highly realistic, human-like speed, dynamic pauses, file creation support, auto-scrolling, and instant hotkey controls.

## Features

- **Hardware Level Typing**: Uses native keyboard simulation to emulate physical keystrokes.
- **Human-like Speed Simulation**: Simulates typing speeds using a Log-Normal distribution paired with context-aware pauses for operators, brackets, and newlines.
- **Cognitive Breaks**: Natural hesitations at semicolons, parentheses, or newlines to replicate human thinking pauses.
- **Auto-Scrolling**: Keeps the cursor dynamically in view without manual scrolling.
- **File Management**: Automatically create and open a new file or open an existing file in your workspace to start your live typing stream.
- **Zero-Conflict Hotkey Controls**: Use `F12` to instantly pause and resume typing on the fly. This keybinding is only active when the live typer is running.

## Requirements

To run this extension, your workspace environment needs the standard node and compiling dependencies to manage native OS level automation tools.

## Extension Settings

You can customize the extension directly in the VS Code Settings Editor (`Ctrl+,` or `Cmd+,`):

* `livetyper.wpm`: Base typing speed in Words Per Minute (WPM). (Default: `55`)
* `livetyper.variance`: Keystroke rhythm randomness. (Default: `0.35`)
* `livetyper.errorRate`: Chance of making typos and automatically self-correcting them. (Default: `0.015`)
* `livetyper.testMode`: Toggle to use seconds instead of minutes for test runs. (Default: `false`)
* `livetyper.workDurationMinutes`: Time in minutes between scheduled review breaks. (Default: `15`)
* `livetyper.breakDurationMinutes`: Length of review breaks. (Default: `3`)

## Release Notes

### 0.0.1

- Initial release of Live Typer with hardware keyboard simulation, cognitive breaks, auto-scroll, setting integrations, and F12 hotkey controls.