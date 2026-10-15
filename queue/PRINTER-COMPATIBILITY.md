# Bambu A1 mini integration decision

## Current user setup
- Two Bambu Lab A1 mini printers
- Bambu Cloud mode
- Bambu Studio
- Firmware version not yet identified

## Finding
The queue must not send printer-control commands directly to an undocumented Bambu Cloud endpoint. Bambu Lab's official January 2025 authorization announcement says initiating a print job over LAN or Cloud is a protected operation, and directs third-party integration developers to contact `devpartner@bambulab.com` for technical documentation and partner support. Bambu Connect can transmit sliced Bambu G-code and 3MF files, but the public documentation reviewed does not establish a stable general-purpose HTTP API for an unrelated custom website to submit jobs.

Official references:
- Bambu Lab authorization and Bambu Connect announcement: https://blog.bambulab.com/firmware-update-introducing-new-authorization-control-system-2/
- Bambu Lab third-party integration/partner information: https://bambulab.cn/zh-cn/trust-center/collaboration
- Bambu Lab status: https://status.bambulab.com/

## Recommended path
1. Keep both printers in Cloud mode and keep physical submission disabled.
2. Check firmware in Bambu Studio or on each printer's device/settings page. Do not downgrade firmware or change LAN mode as a workaround.
3. Request the official third-party integration documentation/SDK from Bambu Lab. Ask specifically whether a Windows-hosted private job queue can submit already-sliced 3MF/G-code to two A1 mini printers in Cloud mode, and what authorization/SDK requirements apply.
4. Until that is answered, use this page for family login, private file storage, library metadata and queue records only.
5. After a supported path is confirmed, add an adapter with explicit printer mapping, atomic queue claiming, duplicate-job protection, printer-busy checks, result/status updates and a physical test on one printer.

## Alternatives (not enabled)
- Bambu Connect desktop client: official client for transferring sliced files; no documented general-purpose remote queue API was confirmed in this review.
- LAN Only + Developer Mode: a different connectivity choice that may permit local third-party control, but it disconnects the printer from Bambu Cloud and is not the requested setup. Do not enable it without explicit user approval.
- Community gateways: some advertise experimental Bambu Cloud support, but that is not an official supported protocol. Do not place Bambu account credentials into one without reviewing its source, security model, license and update process.

## Gate for physical printing
The bridge must stay read-only until a documented and compatible submission method is implemented and verified. Queue entries are not print commands and must not be presented as completed/started prints.