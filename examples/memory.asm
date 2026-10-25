; Memory: watch the dump around the latest write.
; The first store changes C000H from 00 to 11. The next two fill C001H and C002H.
        ORG 0100H
        LD HL, 0C000H
        LD A, 11H
        LD (HL), A       ; C000H: 00 -> 11
        INC HL
        LD (HL), 22H     ; C001H: 00 -> 22
        INC HL
        LD (HL), 33H     ; C002H: 00 -> 33
        HALT
