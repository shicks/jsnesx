import {Controller} from '../controller.js';

// TODO - keybord buttons to (1) pause/resume, (2) speed up/slow down,
//        (3) save/restore state [consider multiple states?]

// Mapping keyboard code to [controller, button]
const KEYS = {
  88: [1, Controller.BUTTON_A], // X
  89: [1, Controller.BUTTON_B], // Y (Central European keyboard)
  90: [1, Controller.BUTTON_B], // Z
  17: [1, Controller.BUTTON_SELECT], // Right Ctrl
  13: [1, Controller.BUTTON_START], // Enter
  38: [1, Controller.BUTTON_UP], // Up
  40: [1, Controller.BUTTON_DOWN], // Down
  37: [1, Controller.BUTTON_LEFT], // Left
  39: [1, Controller.BUTTON_RIGHT], // Right
  103: [2, Controller.BUTTON_A], // Num-7
  105: [2, Controller.BUTTON_B], // Num-9
  99: [2, Controller.BUTTON_SELECT], // Num-3
  97: [2, Controller.BUTTON_START], // Num-1
  104: [2, Controller.BUTTON_UP], // Num-8
  98: [2, Controller.BUTTON_DOWN], // Num-2
  100: [2, Controller.BUTTON_LEFT], // Num-4
  102: [2, Controller.BUTTON_RIGHT], // Num-6
};

export class KeyboardController {
  constructor(main) {
    this.main = main;

    document.addEventListener("keydown", (e) => this.handleKeyDown(e));
    document.addEventListener("keyup", (e) => this.handleKeyUp(e));
    document.addEventListener("keypress", (e) => this.handleKeyPress(e));
  }

  handleKeyDown(e) {
    if (e.target.tagName == 'INPUT') return;
    var key = KEYS[e.keyCode];
    if (key) {
      this.main.nes.buttonDown(key[0], key[1]);
    } else if (!this.main.handleKeyDown(e)) {
      return;
    }
    e.preventDefault();
  }

  handleKeyUp(e) {
    if (e.target.tagName == 'INPUT') return;
    var key = KEYS[e.keyCode];
    if (key) {
      this.main.nes.buttonUp(key[0], key[1]);
      e.preventDefault();
    } else if (this.main.handleKey(e)) {
      e.preventDefault();
    }
  }

  handleKeyPress(e) {
    if (e.target.tagName == 'INPUT') return;
    e.preventDefault();
  }
}
