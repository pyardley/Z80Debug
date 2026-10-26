; Arithmetic, decimal adjust, relative hops, and nibble rotates.
; ADD pops both bytes. A carry steps into the next column. CP leaves A alone.
; ADD HL steps a carry from the low byte into the high byte.
; DAA adjusts the two hex digits of A from H, N, and C.
; DJNZ rolls B down. A taken DJNZ or JR hops along the source.
; RLD rotates the low nibble of A with the two nibbles of (HL).
        ORG 0100H
        LD A, 0FH
        ADD A, 01H
        LD L, 01H
        ADC A, L
        LD H, 0C0H
        LD (HL), 01H
        SUB (HL)
        LD IX, 4000H
        LD (IX+1), 00H
        SBC A, (IX+1)
        LD IY, 5000H
        LD (IY+0FFH), 10H
        CP (IY+0FFH)
        LD BC, 0001H
        LD HL, 00FFH
        ADD HL, BC
        LD IX, 00FFH
        ADD IX, BC
        LD IY, 00FFH
        ADD IY, BC
        SCF
        ADC HL, BC
        OR A
        LD HL, 0100H
        SBC HL, BC
        LD A, 08H
        ADD A, 08H
        DAA
        LD B, 02H
AGAIN:  DJNZ AGAIN
        JR Z, STOP
        JR GO
        HALT
GO:     LD HL, 0C000H
        LD (HL), 23H
        LD A, 0F1H
        RLD
        RRD
STOP:   HALT
