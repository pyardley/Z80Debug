; Undocumented 8-bit halves of IX and IY.
; IXH is the high byte of IX and IXL is the low byte. IYH and IYL are the same for IY.
; A load moves one of those bytes the way B and C move. INC and DEC roll that half. ADD A adds it.
        ORG 0100H
        LD A, 12H
        LD IXH, A       ; A into IXH
        LD IXL, A       ; A into IXL
        LD A, IXH       ; IXH back into A
        LD A, IXL       ; IXL back into A
        INC IXL         ; IXL up by one
        DEC IXH         ; IXH down by one
        LD A, 01H
        ADD A, IXH      ; A adds IXH
        LD A, 34H
        LD IYH, A       ; A into IYH
        LD IYL, A       ; A into IYL
        LD A, IYH       ; IYH back into A
        LD A, IYL       ; IYL back into A
        INC IYL         ; IYL up by one
        DEC IYH         ; IYH down by one
        LD A, 01H
        ADD A, IYL      ; A adds IYL
        HALT
