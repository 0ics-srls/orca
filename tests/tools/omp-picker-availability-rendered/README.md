# Workspace agent picker availability (#14319)

Run `ORCA_BACKGROUND_LAUNCH=1 node tests/tools/omp-picker-availability-rendered/run.mjs`.
Uses the production AgentCombobox, catalog, availability partition and canonical CSS
in a hidden Electron renderer. Rebuilds the existing background-launch harness;
all windows must remain invisible and unfocused. No dependency install or agent/model
request is made. The harness closes its own app.

The supplied host has Pi available. Searching `omp` shows the OMP not-detected reason;
a separate case disables OMP and shows the settings reason. Enter cannot select an
unavailable agent, and Manage agents invokes its callback. CDP screenshots wait for
animations. Reports and screenshots remain in `.bench-fixtures/omp-picker-availability-*`.

Before proof uses baseline AgentCombobox source and `ORCA_OMP_PICKER_BASELINE=1`;
both queries show only generic no-match text. Two component regressions fail before.

The fixture supplies host detection results and settings; it does not contact a real
SSH/WSL host, run PATH detection, launch an agent or navigate the actual settings page.
The workspace-card regression checks the selected-host results reach the picker.
Unknown detection retains prior behavior and does not claim an agent is absent.
The existing Manage agents navigation remains unchanged; select the intended host
there when checking remote installation. Other picker callers keep their existing
empty state until they supply availability reasons.
