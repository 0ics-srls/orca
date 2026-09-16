# POSIX command-row framing control

This tests one proposed origin of a false PID/PPID cycle: command arguments containing newline characters becoming additional process-table rows.

```sh
ORCA_BACKGROUND_LAUNCH=1 node docs/audits/posix-command-row-framing/reproduce.cjs
```

The script starts one short-lived Node child through the shared process wrapper with newline, carriage-return and tab characters in its arguments. It queries only that child with the production `ps` column shape and uses the actual process-table parser. The output records only synthetic argument suffixes, counts, platform and source hashes. Temporary files and the child are cleaned up. No application windows are launched and the unsafe descendant walker is never invoked.

On the tested macOS host, `ps` escaped the newlines and returned one physical row; the parser admitted one process and zero synthetic numeric rows. This is a negative local control for the process-walker hypothesis around #19768. It does not prove all POSIX implementations behave identically, provide a Linux result for #19831, or establish that the affected host's actual process table was acyclic.
