# Windows bridge status

The current draft intentionally does not submit physical printer jobs. The bridge implementation is not yet complete, and print-start commands remain disabled.

Install target: Windows PC at home, Python 3.11+, outbound HTTPS to Supabase. Store all privileged credentials in a local environment file excluded from Git. Do not expose the PC or printer ports to the public internet.

Before implementing a live adapter, verify the official Bambu integration SDK for your A1 mini firmware and Cloud mode. Then add private file download, atomic queue claiming, duplicate prevention, printer-busy checks, per-printer routing, error handling, and status confirmation. Test with a small known-good file on one printer before enabling the second.