; Shifts and rotates. Watch the bits on the toy page.
; Hex stays selected. The byte pops out as eight bits, then slides.
; RLA: the 1 in bit 7 of A (81H) travels into Carry. A settles as 02H.
; S, Z, and P/V do not change on RLA. H and N clear.
; RL B: Carry travels into the low bit of B, and B's top bit travels into Carry.
; RRC C: the low bit of C wraps to the top and also travels into Carry.
        ORG 0100H
        LD A, 81H
        RLA
        LD B, 81H
        RL B
        LD C, 01H
        RRC C
        HALT
