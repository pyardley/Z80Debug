; Stack pane, on the right. The stack grows downward.
; The row marked SP is the top. That byte is the low byte of the top word.
; PUSH moves the pointer down and writes BEEF (low EF, high BE).
; CALL pushes the return address and the pointer moves down again.
; RET moves the pointer back up. POP lifts BEEF into HL.
        ORG 0100H
        LD SP, 0FF00H
        LD HL, 0BEEFH
        PUSH HL
        CALL BACK
        POP HL
        HALT
BACK:   RET
