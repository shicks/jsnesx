import {NROM} from './nrom.js';

const CTRL_MIRROR_MASK       = 0b00011;
const CTRL_MIRROR_ONE_LOWER  = 0b00000;
const CTRL_MIRROR_ONE_UPPER  = 0b00001;
const CTRL_MIRROR_VERTICAL   = 0b00010;
const CTRL_MIRROR_HORIZONTAL = 0b00011;

const CTRL_PRG_16K    = 0b01000;  // else 32K
const CTRL_PRG_MASK   = 0b01100;
const CTRL_PRG_16K_LO = 0b01100;
const CTRL_PRG_16K_HI = 0b01000;

const CTRL_CHR_4K = 0b10000;  // else 8K

// Mapper 1
export class MMC1 extends NROM {
  constructor() {
    super();
    // 5-bit buffer
    this.shiftRegister = 0xf8;
    // $8000
    this.control = CTRL_MIRROR_ONE_LOWER | CTRL_PRG_SWITCH_LO | CTRL_CHR_8K;
    // $A000
    this.chrLo = 0;
    // $C000 -- only matters in 4K mode
    this.chrHi = 0;
    // $E000
    this.prgPage = 0;

    // NOTE: this is hideous, we need to pull these constants into a static
    this.mirrorTypes = {
      [CTRL_MIRROR_ONE_LOWER]: this.nes.rom.SINGLESCREEN_MIRRORING,
      [CTRL_MIRROR_ONE_UPPER]: this.nes.rom.SINGLESCREEN_MIRRORING2,
      [CTRL_MIRROR_HORIZONTAL]: this.nes.rom.HORIZONTAL_MIRRORING,
      [CTRL_MIRROR_VERTICAL]: this.nes.rom.VERTICAL_MIRRORING,
    };
  }

  reset() {
    super.reset();
    this.shiftRegister = 0xf8;
    this.control = CTRL_MIRROR_ONE_LOWER | CTRL_PRG_SWITCH_LO | CTRL_CHR_8K;
    this.chrLo = 0;
    this.chrHi = 0;
    this.prgPage = 0;
    this.update();
  }

  initializePrgRom() {
    this.update();
  }

  write8(address, value) {
    // TODO(sdh): consider storing the cycle of the last write and ignoring
    // if it was too recent (cf. Bill and Ted)
    if (value & 0x80) {
      // High bit in written value resets
      this.shiftRegister = 0xf8;
      this.control = this.control | CTRL_PRG_16K_LO;
      this.loadPrgPage(0x8000, this.prgPage >>> 1, 0x8000);
      return;
    }
    this.shiftRegister <<= 1;
    this.shiftRegister &= value & 1;
    if (this.shiftRegister & 0x80) return;

    // This is the fifth write, so shiftRegister now contains the value
    if (address < 0xc000) {
      if (address < 0xa000) {
        this.control = this.shiftRegister;
      } else {
        this.chrLo = this.shiftRegister;
      }
    } else {
      if (address < 0xe000) {
        this.chrHi = this.shiftRegister;
      } else {
        this.prgPage = this.shiftRegister;
      }
    }
    this.update();
  }

  update() {
    const ctrl = this.control;
    this.nes.ppu.setMirroring(this.mirrorTypes[ctrl & CTRL_MIRROR_MASK]);
    if (ctrl & CTRL_PRG_16K) {
      if ((ctrl & CTRL_PRG_MASK) == CTRL_PRG_16K_LO) {
        this.loadPrgPage(0x8000, this.prgPage, 0x4000);
        this.loadPrgPage(0xc000, 0xf, 0x4000);
      } else {
        this.loadPrgPage(0x8000, 0, 0x4000);
        this.loadPrgPage(0xc000, this.prgPage, 0x4000);
      }
    } else {
      this.loadPrgPage(0x8000, this.prgPage >>> 1, 0x8000);
    }
    if (ctrl & CTRL_CHR_4K) {
      this.loadChrPage(0x0000, this.chrLo, 0x1000);
      this.loadChrPage(0x1000, this.chrHi, 0x1000);
    } else {
      this.loadChrPage(0x0000, this.chrLo >>> 1, 0x2000);
    }
  }

  // eslint-disable-next-line no-unused-vars
  switchLowHighPrgRom(oldSetting) {
    // not yet.
  }

  switch16to32() {
    // not yet.
  }

  switch32to16() {
    // not yet.
  }

  toJSON() {
    var s = super.toJSON();
    s.mmc1 = [
      this.shiftRegister,
      this.control,
      this.chrLo,
      this.chrHi,
      this.prgPage,
    ];
    return s;
  }

  fromJSON(s) {
    super.fromJSON(s);
    [this.shiftRegister, this.control, this.chrLo, this.chrHi, this.prgPage] =
        s.mmc1;
    this.update();
  }
}
