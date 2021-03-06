# Using the disassembler

JSNESx has a built-in logging disassembler.  The basic idea is that you
play the game as thoroughly as possible while logging all the code and
data.  This log is used to generate a thorough disassembly output.

To use it, start at [https://shicks.github.io/jsnesx][1].  Before selecting a
rom to load, use the "Debug > Code-Data Logger" menu to start logging.
Pick a filename to log to by clicking the `+` button at the top corner
of the "Select a log file" dialog and typing a name (e.g. `rom.cdl`).
Then load the rom by clicking the `^` button at the top corner of the
"Select a ROM image" dialog and picking the file on disk.  Once the files
have been picked once, they should appear directly in the list in the
future and can just be clicked on.

[1]: https://shicks.github.io/jsnesx

Optionally, before selecting a rom, start a recording using the "Movie > Record"
menu.  This sets up "Q" and "W" as hotkeys to save the keyframe and restore the
most recent keyframe, respectively.  Recording a movie can help interpret frame
coverage data.

Once a rom is selected, play the game thoroughly.  The controls are arrow keys
for dpad, "Z" for the B button, "X" for the A button, ctrl for select and enter
for start.

After playing through the game as thoroughly as possible (this can be done in
multiple sittings if the CDL file is loaded at the start and written at the
end of each), use the "Code-Data Logger" dialog to "write" the file (without
this, it will not be saved).  The raw data can be downloaded with "File >
Download File".  The "disassemble" button will download the disassembled
rom as a *.s file, which can be opened with an ordinary text editor.

Each byte of the rom is disassembled either as an instruction, as an address,
or as a byte.  Addresses are annotated whether they were used as a jump address
(with a "jump" comment) or otherwise as a data address.  Entry points and data
table roots are marked with labels.  Comments are inserted after many .byte
lines indicating any of the following:

 * "bg" - the data is written to the nametable (background graphics)
 * "spr" - the data is written to the sprite table (foreground graphics)
 * "pal" - the data is written to the palette table (color)
 * "chr" - the data is written to character RAM (tile graphics)
 * "apu" - the data is written to the audio processor
 * "miss" - no bytes on this line were actually covered in the log

## Banked addresses

Addresses are displayed in the form $01:9234.  This indicates the
physical address that was read ($9234) as well as the bank ($01).
To translate this address to an offset in the rom image, multiply
the bank by $2000 and add it to the low 13 bits of the physical address
($1234 in this example: the left-most digit will only be 0 or 1).  Thus,
$01:9234 corresponds to byte $3234 in the rom (which will be byte $3244
in the file when the 16-byte header is taken into account).

## Controls

A gamepad may be used (when plugged in, it may prompt for button
configuration, which can be reset with "NES > Clear Gamepads".  (There
may be bugs with the gamepad support; an alternate approach is to use
a joy2key-type program to map the joyestick to the keyboard bindings
above).  If the second controller is needed, a useful trick is "NES >
Virtual Controllers".  A button can be held by pressing the mouse on
top of it, then moving the mouse off before releasing (which can
allow, e.g., up+a to be pressed on controller 2).

Music can be toggled with the "M" key.  It is off by default.

## Coverage testing

Another technique to try after disassembling the rom is to do coverage
testing.  This is useful for figuring out what parts of the rom handle a
certain action.  Use the "Debug > Coverage" menu to start the tool.  Play
the game for a while, avoiding triggering the action in question, then
press "U" to indicate that the bytes you're looking for are _uncovered_.
After pressing "U", do something that should cause the bytes in question
to be covered (either executed, read, or written), and quickly press "C"
to mark it covered.  This may be repeated multiple times.  The coverage
dialog will display a list of rom offsets that satisfy all the constraints
(and may be toggled between offsets that are executed, read, or written).
Note that read/written offsets may correspond to RAM addresses.
