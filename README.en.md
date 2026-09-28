# Open Perfboard

<p align="center">
  <img src="images/logo.png" alt="Open Perfboard logo" width="160" />
</p>

<p align="center">
  <b>Open-Perfboard</b><br />
  Place pins and connect them — design and documentation in one All-in-One Offline Design Program
</p>

<div align="center">

[![License: GPL-3.0-or-later](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.0-15803d)](../../releases/latest)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078D6)](#install)
![Offline](https://img.shields.io/badge/offline-no%20account%20needed-555)

[한국어](README.md) · [Install](#install) · [Usage](#usage) · [Feedback](#feedback) · [Roadmap](#roadmap)

</div>

![Demo](images/demo-en.gif)

> This project is **in its feature-testing stage**. Please leave [feedback](#feedback) — it will shape what comes next.

## Features

- **Pins on photos**: click terminals on a part photo to add pins, draw guide lines to space pins evenly or snap them onto a line; attach datasheet PDFs
- **Pin-to-pin wiring**: orthogonal routing, branches, crossing hops. Wires never run across parts
- **Wire list and BOM, generated as you draw**: wire color (8 presets + RGB spectrum / typed values), gauge, length; unit prices, totals, purchase links
- **Connection labels**: name tags like `Control board -> IMU : SDA` instead of lines show where and how each pin connects (Simulink Goto/From style). Signal directions are set per wire in the netlist; click a part to flip through the parts connected to it
- **Export**: PDF report, Excel / CSV, PNG
- **Also**: collapsible side panels, autosave and recovery, parts bin sharing (`.opblib`), Korean / English, no limit on parts or wires

| Part editor | Wire specs |
| --- | --- |
| ![Part editor: pins placed per connector on a part photo](images/part-editor-en.png) | ![Selected wire: gauge, length, color, label](images/wire-en.png) |
| **Bill of materials (BOM)** | **Wire list** |
| ![BOM: ref, name, part no., quantity, unit price, amount, purchase link](images/bom-en.png) | ![Wire list: from/to pins, signals, color, gauge, length](images/netlist-en.png) |

**Netlist connection labels**: like Simulink Goto/From, a line runs from each pin on the part photo to a name tag. Tags with the same name are connected, and arrows show the signal direction. Click a tag to see its pair and the wire details, and change the signal direction (`->` `<-` `<->`) in the bar above. Click a part photo or **Connections** to open a popup: the part on the left, and its connected parts on the right, one at a time (◀ ▶ or the list).

![Netlist connection labels: name tags linked to each pin on the part photo, the selected tag and its wire details](images/labels-en.png)

![Connection popup: the control board on the left, the connected motor driver on the right](images/labels-popup-en.png)

## Install

Windows 10 / 11 (64-bit). Linux support is planned.

1. Download `Open Perfboard Setup <version>.exe` from [Releases](../../releases/latest)
2. Run it (no admin rights needed)

> If Windows shows "Windows protected your PC", click **More info → Run anyway**.

## Usage

1. **Make a part**: **＋ New part** in the parts bin → choose a photo → click terminals to add pins
2. **Place**: drag the part onto the canvas
3. **Connect**: `W` → click a pin → click another pin (click empty space to bend)
4. **Export**: check **BOM / Netlist** at the top → **Export ▾**

![final result](images/main-en.png)


| Key | Action | Key | Action |
| --- | --- | --- | --- |
| `V` / `W` | Select / wire mode | `R` / `F` | Rotate / flip |
| `Esc` | Cancel drawing | `Delete` | Delete |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo | `Home` | Fit to view |
| Wheel | Zoom in / out | `Space`+drag | Pan |

All shortcuts are listed under the **?** button in the app (`F1`).

## Feedback

- Tell us what got in the way or what could be improved in an [issue](../../issues/new).
- If you like it, a **⭐ star** helps a lot.

## Roadmap

1. Wire cut list
2. Housing and terminal parts
3. Linux support
4. Schematics
5. KiCad integration
6. AI part import

The final goal is **firmware compilation and simulation (SILS / HILS)** within this app.

## Development

Requires Node.js 22 or later.

```bash
npm ci              # install dependencies
npm run dev         # run in development
npm run check       # type check + unit tests
npm run test:e2e    # end-to-end tests
npm run dist:win    # build the installer → dist/
```

> If PowerShell (the default VS Code terminal) says `npm.ps1 cannot be loaded because running scripts is disabled`, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once and open a new terminal. To leave the setting alone, use `npm.cmd` instead of `npm`.

## License

[GPL-3.0-or-later](LICENSE). Anyone may use and modify it; if you distribute a modified version, you must publish its source too.

> This project has been developed by Claude Code.