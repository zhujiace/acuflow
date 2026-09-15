# AcuFlow executable icon

`acuflow.ico` is the Windows icon written into the packaged `acuflow.exe`
(see `packages/opencode/script/build.ts`, `compile.windows.icon`).

- Source glyph: [Health Icons](https://healthicons.org) `stethoscope` (filled), licensed under **MIT**.
- Composed as a white stethoscope on a teal rounded tile (512 px) and exported to a
  multi-size `.ico` (16/24/32/48/64/128/256) with `sharp` + `png-to-ico`.

To use your own icon, replace `acuflow.ico` with any Windows `.ico` (multiple sizes
recommended), then re-run the `build-windows` GitHub Actions workflow.
