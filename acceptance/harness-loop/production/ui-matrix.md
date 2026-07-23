# HLE-C4R / HLE-C5 renderer visual matrix

Overall: PASS

- Source state: real BioF3 Vite renderer connected to the same local R/Python
  services and SQLite used by the Electron development shell.
- Evidence boundary: screenshots verify the application renderer, not macOS
  window chrome. Electron startup and backend restart are verified separately
  by the production restart matrix and development-shell logs.
- Privacy: screenshots contain only the local SPT-1 demo project, opaque IDs,
  public stage conclusions and resource/usage summaries. No credentials,
  endpoint URLs, headers or hidden reasoning are present.

| State | Theme / viewport | Evidence | Result |
| --- | --- | --- | --- |
| Running, compact progress | system light, 1280×720 | `ui/running-light-1280.png` | PASS |
| Running, expanded summary | system light, 1280×720 | `ui/summary-expanded-running-light-1280.png` | PASS |
| Running, expanded summary | dark, 1280×720 | `ui/summary-expanded-running-dark-1280.png` | PASS |
| Completed, expanded summary | system light, 1280×720 | `ui/completed-expanded-system-light-1280.png` | PASS |
| Completed, responsive summary | system light, 820×900 | `ui/completed-expanded-system-light-820.png` | PASS |
| Scientific input requires user | dark, 1280×720 | `ui/waiting-for-user-dark-1280.png` | PASS |
| User-cancelled history retained | dark, 1280×720 | `ui/cancelled-history-dark-1280.png` | PASS |
| Restart recovery required | dark, 1280×720 | `ui/recovery-required-dark-1280.png` | PASS |

Acceptance observations:

- Running, completed, waiting, cancelled and recovery-required states use
  distinct, truthful labels; blocked/failed/cancelled are never rendered as
  green completion.
- The compact panel keeps one public conclusion per stage; detailed tool
  activity remains behind disclosure.
- Expanded project summary shows Loop status, iterations, active/background
  counts, Token/cost summary, workflow progress and runtime resources.
- The 820×900 capture was taken with
  `innerWidth=clientWidth=scrollWidth=820`; the navigation collapses and there
  is no page-level horizontal overflow.
- Reopening historical conversations preserves public stage conclusions after
  stop/cancel; a restart-interrupted Loop exposes recovery-required rather than
  silently starting a duplicate Job.
- Theme preference was restored to “follow system” after the matrix.
