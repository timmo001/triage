---
title: Install
description: Install Triage from the timmo pacman repository, as a Home Assistant app or container, or from a release.
---

Triage is a single Linux binary for x86_64 and aarch64. The server also comes as a container image and a Home Assistant app.

## Arch Linux

Packages are published to the unofficial `timmo` pacman repository. Add it before the other repository sections in `/etc/pacman.conf`:

```ini
[timmo]
SigLevel = PackageRequired DatabaseOptional TrustedOnly
Server = https://packages.timmo.dev/$arch
```

Then install one of the two packages:

| Package | Built from |
| --- | --- |
| `triage-bin` | The latest release |
| `triage-git` | Every push to `main` |

```bash
sudo pacman -Syu triage-bin
```

Both install the `triage` command, shell completions and three user services: `triage-agent.service`, `triage-server.service` and `triage-worker.service`. None is enabled on install, since each machine takes on different roles. On upgrade, the package restarts the ones that are running.

## Home Assistant

The Home Assistant app runs the server on Home Assistant OS, for amd64 and aarch64. Add this repository to the app store:

[![Add the repository to Home Assistant](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Ftimmo001%2Ftriage)

then install Triage, set its admin token and start it. See [Run a server](/setup/server#home-assistant).

## Container

`ghcr.io/timmo001/triage` runs the server, for amd64 and arm64. See [Run a server](/setup/server#container).

## Debian, Ubuntu and Fedora

Each [GitHub release](https://github.com/timmo001/triage/releases) has `.deb` and `.rpm` packages:

```bash
# Debian and Ubuntu
sudo apt install ./triage_<version>_amd64.deb

# Fedora
sudo dnf install ./triage-<version>-1.x86_64.rpm
```

## Release archive

Each release also has a `triage-<version>-linux-<arch>.tar.gz` archive with just the binary. Put it somewhere on your `PATH`:

```bash
tar -xzf triage-<version>-linux-x86_64.tar.gz
install -Dm755 triage ~/.local/bin/triage
```

Release assets come with a `SHA256SUMS` file and a Sigstore bundle. To check an asset was built by this repository's release workflow:

```bash
gh attestation verify triage-<version>-linux-x86_64.tar.gz --repo timmo001/triage
```

## Build from source

You need [mise](https://mise.jdx.dev), which installs the pinned Bun and Node versions:

```bash
git clone https://github.com/timmo001/triage.git
cd triage
mise install
mise run build
```

The binary is written to `dist/triage`.

## Next steps

- [Run a server](/setup/server).
- [Add the machines](/setup/hosts) to collect from.
