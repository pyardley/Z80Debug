# Third-party code

Z80Debug links these packages. Versions match `package.json`.

## Runtime

| Package | Version | License | URL |
| --- | --- | --- | --- |
| z80-emulator | 2.3.0 | MIT | https://github.com/lkesteloot/trs80/tree/master/packages/z80-emulator |
| z80-asm | 2.3.0 | MIT | https://github.com/lkesteloot/trs80/tree/master/packages/z80-asm |
| z80-disasm | 2.2.3 | MIT | https://github.com/lkesteloot/trs80/tree/master/packages/z80-disasm |
| z80-base | 2.0.1 | MIT | https://github.com/lkesteloot/trs80/tree/master/packages/z80-base |

The four libraries are Copyright © Lawrence Kesteloot and published under the MIT license: https://github.com/lkesteloot/trs80/blob/master/LICENSE

npm registry pages:

- https://www.npmjs.com/package/z80-emulator
- https://www.npmjs.com/package/z80-asm
- https://www.npmjs.com/package/z80-disasm
- https://www.npmjs.com/package/z80-base

`z80-disasm` declares a dependency on [commander](https://github.com/tj/commander.js) 4.x (MIT, https://github.com/tj/commander.js/blob/master/LICENSE). That dependency is only used by the package's command-line entry. This debugger imports the disassembler library and does not ship the CLI.

## Development

These tools build and test the page. They are not part of the emulator.

| Package | License | URL |
| --- | --- | --- |
| Vite | MIT | https://github.com/vitejs/vite |
| Vitest | MIT | https://github.com/vitest-dev/vitest |
| TypeScript | Apache-2.0 | https://github.com/microsoft/TypeScript |
