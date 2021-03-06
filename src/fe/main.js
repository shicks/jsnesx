import {CodeDataLog} from '../cdl.js';
import {Controller} from '../controller.js';
import {Debug, SourceMap} from '../debug.js';
import {NES} from '../nes.js';
import {Playback, Recorder, Movie} from '../movie.js';
import {Screen} from './screen.js';
import {Speakers} from './speakers.js';
import {GamepadController} from './gamepadcontroller.js';
import {KeyboardController} from './keyboardcontroller.js';
import {FrameTimer} from './frametimer.js';
import * as debug from './debugger.js';
import {Component} from './component.js';
import {FileSystem} from './fs.js';
import {dynamicImport} from './utils.js';
import {Menu} from './menu.js';

const bufferLog = () => {}; console.log.bind(console);

class Main {
  constructor(screen) {
    this.state = {
      running: false,
      paused: true,
      loading: true,
      loadedPercent: 3,
    };

    this.fs = new FileSystem();
    this.romName = null;
    this.patch = {};

    this.screen = new Screen(screen);
    // screen - onGenerateFrame => this.nes.frame() ?

    this.hash = {};
    for (const component of window.location.hash.substring(1).split('&')) {
      const split = component.split('=');
      this.hash[split[0]] = decodeURIComponent(split[1]);
    }

    this.speakers = new Speakers({
      onBufferUnderrun: (actualSize, desiredSize) => {
        if (!this.state.running || this.state.paused) {
          return;
        }
        // Skip a video frame so audio remains consistent. This happens for
        // a variety of reasons:
        // - Frame rate is not quite 60fps, so sometimes buffer empties
        // - Page is not visible, so requestAnimationFrame doesn't get fired.
        //   In this case emulator still runs at full speed, but timing is
        //   done by audio instead of requestAnimationFrame.
        // - System can't run emulator at full speed. In this case it'll stop
        //    firing requestAnimationFrame.
        bufferLog(
          "Buffer underrun, running another frame to try and catch up"
        );
        this.nes.frame();
        // desiredSize will be 2048, and the NES produces 1468 samples on each
        // frame so we might need a second frame to be run. Give up after that
        // though -- the system is not catching up
        if (this.speakers.buffer.size() < desiredSize) {
          bufferLog("Still buffer underrun, running a second frame");
          this.nes.frame();
        }
      }
    });

    this.nes = window.nes = new NES({
      onFrame: this.screen.setBuffer.bind(this.screen),
      onStatusUpdate: console.log,
      onAudioSample: this.speakers.writeSample.bind(this.speakers),
      onBreak: (midFrame) => {
        this.stop();
        if (midFrame && this.nes.ppu.scanline > 0) this.partialRender();
      },
      getScreenshot: () => {
        const bin = atob(screen.toDataURL().replace(/^[^,]*,/, ''));
        return Uint8Array.from(bin.split('').map(c => c.charCodeAt(0)));
        // inverse: 'data:image/png;base64,' +
        //          btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
      },
    });
    if (!this.hash['nodebug']) this.nes.debug = new Debug(this.nes);

    this.frameTimer = new FrameTimer({
      onGenerateFrame: () => {
        this.nes.papu.soundEnabled = this.speakers.enabled;
        this.nes.ppu.renderThisFrame = true;
        this.nes.frame();
      },
      onWriteFrame: () => {
        this.screen.writeBuffer();
        this.gamepadController.update();
        for (const component of this.components()) {
          component.frame();
        }
      },
      onSkipFrame: () => {
        this.nes.papu.soundEnabled = this.nes.ppu.renderThisFrame = false;
        this.nes.frame();
      },
    });

    this.keyboardController = new KeyboardController(this);
    this.gamepadController = new GamepadController(this);

    // window.addEventListener("resize", this.layout.bind(this));
    // this.layout();
    this.load(this.hash['rom']);
    if (this.hash['playback']) {
      // TODO - add these params to the hash automatically?
      const pb = this.startPlayback(this.hash['playback']);
      if (this.hash['keyframe'] != null) {
        pb.then(p => {
          p.selectKeyframe(this.hash['keyframe']);
          p.seekToKeyframe();
        });
      }
    } else if (this.hash['record']) {
      (async () => {
        const file = this.hash['record'];
        const data = await this.fs.open(file);
        const movie = data && data.byteLength ?
              Movie.parse(file.data, 'NES-MOV\x1a') : undefined;
        this.nes.movie = new Recorder(main.nes, movie);
        const panel = new debug.RecordPanel(this, file);
        if (movie) {
          panel.selectKeyframe(Infinity);
          panel.seekToKeyframe();
        } else {
          panel.start();
        }
      })();
    }
    if (this.hash['breakAt']) {
      const b = this.hash['breakAt'].split(':');
      b[0] = Number.parseInt(b[0], 16);
      if (!b[1]) b[1] = 'prg';
      if (!b[2]) b[2] = 'x';
      this.nes.debug.breakAt(...b);
    }
  }

  setFrameSkip(skip) {
    this.frameTimer.frameSkip = skip;
    this.speakers.enabled = false;
  }

  setHash(key, value) {
    const components = [];
    for (const component of window.location.hash.substring(1).split('&')) {
      if (!component) continue;
      const split = component.split('=');
      if (split[0] === key) {
        components.push(`${key}=${encodeURIComponent(value)}`);
        key = undefined;
      } else {
        components.push(component);
      }
    }
    if (key) components.push(`${key}=${encodeURIComponent(value)}`);
    window.location.hash = '#' + components.join('&');
    this.hash[key] = value;
  }

  async load(romName = undefined) {
    if (romName) {
      const data = await this.fs.open(romName);
      if (data) {
        this.handleLoaded(romName, data.data);
        return;
      }
    }
    const file = await this.fs.pick('Select a ROM image', 'nes');
    if (file) {
      this.handleLoaded(file.name, file.data);
      this.setHash('rom', file.name);
    }
  }

  download() {
    FileSystem.download(this.rom, 'patched.nes');
  }

  async pickDownload() {
    let file;
    try {
      file = await this.fs.pick('Select file to download');
    } catch (err) {
      return; // cancel is okay
    }
    if (file) FileSystem.download(file.data, file.name);
  }

  async handleLoaded(name, data) {
    if (this.running) this.stop();
    this.state.uiEnabled = true;
    this.state.running = true;
    this.state.loading = false;
    this.romName = name;

    let rom = this.rom = new Uint8Array(data);
    let patch = this.hash['patch'];
    if (patch) {
      this.patch = await loadExt(patch);
      if (this.patch.default) {
        const p = this.patch.default;
        if (p && p.apply) {
          const newRom = await p.apply(rom, this.hash,
                        `../../ext/${patch.replace(/\/[^/]*$/, '')}/`);
          if (newRom) rom = newRom;
        }
      }
    }

    this.nes.loadROM(rom);

    let init = this.hash['init'];
    if (init) {
      if (/^\/|\./.test(init)) throw new Error(`bad init: ${init}`);
      this.init = await loadExt(init);
      if (this.init.default) {
        const t = this.init.default;
        if (typeof t === 'function') t(this.nes);
      }
    }

    if (this.hash['cdl']) {
      new debug.CodeDataLogger(this, this.hash['cdl']);
      // this.nes.debug.cdl = new CodeDataLog(this.nes);
      // const data = await this.fs.open(this.hash['cdl']);
      // if (data && data.length) this.nes.debug.cdl.merge(data);
    }

    if (!this.hash['noautostart']) this.start();
  }

  start() {
    if (!this.state.paused) return;
    this.state.paused = false;
    this.frameTimer.start();
    this.speakers.enabled = false;
    //this.speakers.start();
    this.fpsInterval = setInterval(() => {
      bufferLog(`FPS: ${this.nes.getFPS()}`);
    }, 1000);
  }

  stop() {
    if (this.state.paused) return;
    this.state.paused = true;
    this.frameTimer.stop();
    this.speakers.stop();
    clearInterval(this.fpsInterval);
    let trace;
    for (const component of this.components()) {
      // if (component instanceof debug.Trace) trace = component;
      component.step();
    }
    // TODO - consider not bringing this up automatically?
    // instead find a different way to indicate we're paused?
    //if (!trace) new debug.Trace(this.nes, () => this.start()).step();
  }

  handlePauseResume() {
    if (this.state.paused) {
      this.start();
    } else {
      this.stop();
    }
  }

  partialRender() {
    this.nes.ppu.triggerRendering();
    this.screen.setBufferPartial(this.nes.ppu.buffer, this.nes.ppu.scanline - 21);
    this.screen.writeBuffer();
  }

  // layout() {
  //   let navbarHeight = parseFloat(window.getComputedStyle(this.navbar).height);
  //   this.screenContainer.style.height = `${window.innerHeight -
  //     navbarHeight}px`;
  //   this.screen.fitInParent();
  // }

  patternTable() {
    return new debug.PatternTableViewer(this.nes);
  }

  spritePatternTable() {
    return new debug.SpritePatternTableViewer(this.nes);
  }

  chrRom(...pages) {
    return new debug.ChrRomViewer(this.nes, pages);
  }

  saveSnapshot() { // q
    window.snapshot = nes.writeSavestate();
  }

  loadSnapshot() { // w
    // main.speakers.stop();
    //main.speakers.clear();
    this.nes.restoreSavestate(window.snapshot);
    // setTimeout(() => main.speakers.start(), window.TIME || 0);
  }

  async startPlayback(file = undefined) {
    if (typeof file == 'string') {
      file = await this.fs.open(file);
    } else if (!file) {
      file = await this.fs.pick('Select movie to play');
    }
    if (!(this.nes.movie instanceof Playback)) {
      this.nes.movie =
          new Playback(this.nes, file.data, () => this.stop());
      this.nes.movie.start();
    }
    return new debug.PlaybackPanel(this.nes);
  }

  handleKeyDown(e) {
    if (e.key == '`') {
      this.setFrameSkip(20);
      return true;
    }
    return false;
  }

  handleKey(e) {
    if (e.key == 'p') {
      this.handlePauseResume();
      return true;
    } else if (e.key == '`') {
      this.setFrameSkip(0);
      return true;
    } else if (e.key == '~') {
      // alternatively, use = and - to speed up/down?
      this.setFrameSkip(this.frameTimer.frameSkip ? 0 : 20);
      return true;
    } else if (e.key == 'm') {
      this.speakers.enabled = !this.speakers.enabled;
      if (this.speakers.enabled) this.speakers.start();
      return true;
    }
    for (const component of this.components()) {
      if (component.handleKey(e)) return true;
    }
    for (const key in this.functions || []) {
      if (e.key == key) {
        this.functions[key]();
        return true;
      }
    }
    return false;
  }

  // TODO - save snapshots to local storage
  //   - consider also storing a screenshot along with?


  // main.track = (type) => {
  //   main.functions[68] = (main) => console.log(main.nes.debug.mt.expectDiff()), // D (Diff)
  //   main.functions[82] = (main) => main.nes.debug.mt.reset(), // R (Reset)
  //   main.functions[83] = (main) => console.log(main.nes.debug.mt.expectSame()), // S (Same)
  //   main.functions[76] = (main) => console.log(main.nes.debug.mt.candidates()), // L (List)
  // };

  track(type) {
    this.nes.debug.coverage.clear();
    main.functions = main.functions || [];
    main.functions['c'] = () => console.log(this.nes.debug.coverage.expectCovered()); // C (Covered)
    main.functions['u'] = () => console.log(this.nes.debug.coverage.expectUncovered()); // U (Uncov)
    main.functions['v'] = () => console.log(this.nes.debug.coverage.candidates(type, true)); // V (List)
  };

  watch(...addrs) {
    new debug.WatchPanel(this.nes, ...addrs);
  }

  * components() {
    for (const el of document.querySelectorAll('#grid > .component')) {
      // for now, just auto-create the Trace component if it's not there.
      const component = Component.map.get(el);
      if (component) yield component;
    }
  }
}

const loadExt = (url) => {
  if (/^\/|\./.test(url)) throw new Error(`bad extension url: ${url}`);
  // if (window.location.href.includes('github.io')) {
  //   return import(`/${url}.js`);
  // }
  return import(`../../ext/${url}.js`);
}

window.Debug = Debug;
window.main = new Main(document.getElementById('screen'));

const promptForNumbers = (text, callback) => {
  const numbers = prompt(text);
  if (!numbers) return;
  const result = [];
  // TODO(sdh): consider supporting ranges?
  for (const num of numbers.split(/[^0-9a-fA-F$]+/)) {
    result.push(
        num.startsWith('$') ?
            Number.parseInt(num.substring(1), 16) :
            Number.parseInt(num, 10));
  }
  callback(result);
};

new Menu('File')
    // TODO - file manager
    .addItem('Load ROM', () => main.load())
    .addItem('Download ROM', () => main.download())
    .addItem('Download File', () => main.pickDownload());
new Menu('NES')
    // TODO - hard reset (need to figure out how)
    .addItem('Reset', () => main.nes.cpu.softReset())
    .addItem('Save States', () => new debug.SnapshotPanel(main))
    .addItem('Virtual Controllers', () => new debug.ControllerPanel(main.nes))
    .addItem('Clear Gamepads', () => main.gamepadController.clearDefaults())
    .addItem('Timer', () => new debug.TimerPanel());
new Menu('Movie')
    .addItem('Playback', async () => {
      
      if (!(main.nes.movie instanceof Playback)) {
        const file = await main.fs.pick('Select movie to play');
        main.nes.movie =
            new Playback(main.nes, file.data, {onStop: () => main.stop()});
        main.nes.movie.start();
      }
      new debug.PlaybackPanel(main.nes);
    })
    .addItem('Record', async () => {
      const file = await main.fs.pick('Select movie to record');
      main.setHash('record', file.name);
      const movie = file.data && file.data.byteLength ?
          Movie.parse(file.data, 'NES-MOV\x1a') : undefined;
      if (!(main.nes.movie instanceof Recorder) || movie) {
        main.nes.movie = new Recorder(main.nes, movie);
        //main.nes.movie.start();
      }
      if (movie) {
        // TODO - seek to last keyframe, pause emulation to continue recording.
      }
      new debug.RecordPanel(main, file.name);
    });

new Menu('Debug')
    .addItem('Trace', () => new debug.Trace(main.nes, () => main.start()).step())
    .addItem('Source Map', async () => {
      const {data} = await main.fs.pick('Select assembly source', 's');
      const decoder = new TextDecoder('utf-8');
      main.nes.debug.sourceMap = new SourceMap(decoder.decode(data));
    })
    .addItem('Watch Page', () => promptForNumbers('Pages', pages => {
      for (const page of pages) new debug.WatchPage(main.nes, page);
    }))
    .addItem('Watch Registers', () => new debug.WatchReg(main.nes))
    .addItem('Watch PPU', () => new debug.WatchPpu(main.nes))
    .addItem('Nametable', () => new debug.NametableTextViewer(main.nes))
    .addItem('Pattern Table', () => new debug.PatternTableViewer(main.nes))
    .addItem('Sprite Pattern Table',
             () => new debug.SpritePatternTableViewer(main.nes))
    .addItem('CHR Viewer', () => promptForNumbers('Banks', banks => {
      new debug.ChrRomViewer(main.nes, banks);
    }))
    .addItem('Coverage', () => new debug.CoveragePanel(main.nes))
    .addItem('Code-Data Logger', async () => {
      if (main.hash['cdl']) {
        new debug.CodeDataLogger(main, main.hash['cdl']);
        return;
      }
      const file = await main.fs.pick('Select log file');
      if (!main.nes.debug.cdl) main.nes.debug.cdl = new CodeDataLog(main.nes);
      if (file.data && file.data.byteLength) {
        main.nes.debug.cdl.merge(file.data);
      }
      main.setHash('cdl', file.name);
      new debug.CodeDataLogger(main, file.name);
    });
new Menu('Help')
    .addItem('Keys', () => new debug.KeysPanel())
    .addItem('Windows', () => new debug.WindowsPanel())

// TODO - new speed debugging?
//  - NOTE - movie came out okay, but there are a few glitches.
//         - only significant one is at very end, maybe re-record.
//         - add a "safety playback" mode that automatically loads snapshots
