# Schedules

A schedule starts a pack's run by itself: every so often, or at a time of day. Open **Schedules** in the menu and press **New schedule**. Give it a name, pick the pack, say when, and which tests and options the run uses (all tests by default, or a preset). The run it starts is a normal run: it shows on the Runs page with the schedule's name beside it, and you watch, pause or review it like any other.

Each card shows when the schedule runs next, its last run and how that went. **Run now** starts the run at once, outside its times; the next time stays as it was. **Runs** lists the runs it started. The menu changes, pauses, resumes or deletes it. Deleting a schedule keeps the runs it started.

## When

- **Every day at** a time, or only on weekdays.
- **Every** so often: `15m`, `2h`, `1d`. Counted from when the schedule was made, so an hourly schedule made at 10:20 runs at 11:20, 12:20 and so on.
- **Cron**: a cron expression with five fields (minute, hour, day of month, month, day of week), for anything else. `0 9 * * 1-5` is 09:00 on weekdays; `*/30 8-18 * * *` is every half hour from 08:00 to 18:30.

Times of day are in a time zone (default this computer's), so a schedule at 02:00 stays at 02:00 when the clocks change. Schedules run at most once a minute.

## While a run is going

A time that comes round while the schedule's last run is still going is skipped, so a slow run never piles up behind itself. The event log says so (`schedule.skipped`). A run that waits behind another run of the same site is still going: it is queued.

## While Watchwright is off

Schedules only start runs while the Watchwright server is running. For a time missed while it was off, each schedule says what to do when it's back:

- **Start once** (the default): one run starts as soon as the server is back, however many times were missed, and then it goes on as usual.
- **Skip it**: wait for the next time.

## Start at sign-in

To keep schedules going after a restart, start Watchwright when you sign in to the computer.

On Windows, turn on **Start at sign-in** in Settings, under Server. It puts a small `Watchwright.cmd` file in your Startup folder (`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`) that starts this server, minimized, on the same port and data folder, without opening the browser. Turning it off deletes the file.

On macOS and Linux, Settings shows the command that starts this server. Run it from a LaunchAgent or a systemd user unit.

On macOS, save this as `~/Library/LaunchAgents/dev.watchwright.plist`, with the program and arguments from Settings, then run `launchctl load ~/Library/LaunchAgents/dev.watchwright.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>dev.watchwright</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/usr/local/lib/node_modules/watchwright/dist/cli/main.js</string>
    <string>serve</string>
    <string>--port</string>
    <string>7420</string>
    <string>--no-open</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
```

On Linux, save this as `~/.config/systemd/user/watchwright.service`, with the command from Settings, then run `systemctl --user enable --now watchwright`:

```ini
[Unit]
Description=Watchwright

[Service]
ExecStart=/usr/bin/node /usr/lib/node_modules/watchwright/dist/cli/main.js serve --port 7420 --no-open
Restart=on-failure

[Install]
WantedBy=default.target
```

## From an agent or a script

Schedules are in the [HTTP API](../reference/http-api#schedules), and so on the command line and as MCP actions. Creating, changing, resuming or deleting a schedule starts runs by itself later, so from anything but the web page it waits for you to approve it there.
