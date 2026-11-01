; Hover a register to read the comment from the load that wrote it.
; A later load replaces the earlier comment. A store does not.
        ORG 0100H
        LD A, 11H       ; page number
        LD B, 22H       ; row
        LD C, 33H       ; column
        LD DE, 4455H    ; range start
        LD HL, 6677H    ; range end
        LD IX, 4000H    ; pixel buffer
        LD IY, 8000H    ; name table
        LD SP, 0FF00H   ; stack top
        LD (HL), A      ; not a register
        LD A, 99H       ; current page
        HALT
