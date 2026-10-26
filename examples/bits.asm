; Bit set, reset, and test. Watch the bits on the toy page.
; Hex stays selected. The byte pops out as eight bits.
; SET 0 of A (00H) turns the low bit on. A becomes 01H. Flags stay as they were.
; RES 0 of that 01H turns the low bit off again.
; BIT 0 of 00H sees a 0, so Z sets. The byte does not change.
; BIT 0 of 01H sees a 1, so Z clears.
        ORG 0100H
        LD A, 00H
        SET 0, A
        RES 0, A
        BIT 0, A
        LD A, 01H
        BIT 0, A
        HALT
