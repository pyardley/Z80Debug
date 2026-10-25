; Flags: step and watch S, Z, H, P/V, N, and C on the flag row.
; LD does not change flags. Each arithmetic line does.
        ORG 0100H
        XOR A, A         ; A=00  S=0 Z=1 H=0 P/V=1 N=0 C=0
        LD A, 7FH        ; flags stay as they were
        ADD A, 01H       ; A=80  S=1 Z=0 H=1 P/V=1 N=0 C=0
        ADD A, 80H       ; A=00  S=0 Z=1 H=0 P/V=1 N=0 C=1
        CCF              ; S=0 Z=1 H=1 P/V=1 N=0 C=0
        OR 01H           ; A=01  S=0 Z=0 H=0 P/V=0 N=0 C=0
        AND 0F0H         ; A=00  S=0 Z=1 H=1 P/V=1 N=0 C=0
        SUB A, 01H       ; A=FF  S=1 Z=0 H=1 P/V=0 N=1 C=1
        HALT
