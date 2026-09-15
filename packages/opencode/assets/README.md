# AcuFlow executable icon

`acuflow.ico` is the Windows icon written into the packaged `acuflow.exe`
(see `packages/opencode/script/build.ts`, `compile.windows.icon`).

- A bold white medical cross on a teal rounded tile, exported to a multi-size
  `.ico` (16/20/24/32/40/48/64/128/256) with `sharp` + `png-to-ico`.
- A simple high-contrast glyph is used deliberately so it stays crisp at the
  small sizes Windows shows in the taskbar/Explorer.

To use your own icon, replace `acuflow.ico` with any Windows `.ico` (multiple sizes
recommended), then re-run the `build-windows` GitHub Actions workflow.
