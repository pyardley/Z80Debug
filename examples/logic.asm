; Logical operations and counters. Watch the toy page.
; Hex stays selected. AND, OR, and XOR pop both bytes out as eight bits.
; AND L of A=F0H and L=0FH clears every bit. A becomes 00H.
; OR L of A=F0H and L=0FH sets every bit. A becomes FFH.
; XOR L of A=FFH and L=0FH flips the low nibble. A becomes F0H.
; INC A rolls 0F to 10. DEC A rolls it back to 0F.
; INC HL rolls 00FF to 0100. The next wheel steps when one passes F.
        ORG 0100H
        LD L, 0FH
        LD A, 0F0H
        AND L
        LD A, 0F0H
        OR L
        LD A, 0FFH
        XOR L
        LD A, 0FH
        INC A
        DEC A
        LD HL, 00FFH
        INC HL
        HALT
