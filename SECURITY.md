# Security policy

## Supported versions

Security fixes go into the latest release. Please update to the [latest version](https://github.com/Kuzuw/signalform/releases/latest) before reporting.

| Version | Supported |
|---|---|
| 1.5.x | Yes |
| < 1.5 | No |

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report them privately through GitHub: go to the repository's **Security** tab and choose **Report a vulnerability**. Include:

- what the problem is and what an attacker could do with it;
- the steps or a file (for example a crafted `.sfscene`) that reproduce it;
- the Signalform and Windows versions you tested.

You should get a reply within a week. Once the problem is confirmed, a fix is released as soon as practical, and you're credited in the release notes unless you'd rather not be.

## Scope

Signalform runs locally and doesn't connect to the internet. The most relevant areas are:

- files it opens: scenes (`.sfscene`), presets and audio files;
- the bridge between the interface and the main process (`main/preload.js`, IPC handlers in `main/main.js`);
- the installer and the bundled ffmpeg.
