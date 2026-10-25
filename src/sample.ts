export const SAMPLE_SOURCE = `; Sample: set registers, store a byte, change flags, then exchange.
; EX AF,AF' swaps only AF. EXX swaps BC, DE, and HL.
VALUE   EQU 3CH
        ORG 0100H
        LD SP, 0FF00H
        LD IX, 4000H
        LD IY, 8000H
        LD A, VALUE
        LD BC, 1234H
        LD DE, 5678H
        LD HL, 9ABCH
        LD (0C000H), A
        ADD A, 0C4H
        EX AF, AF'
        EXX
        LD B, 0FFH
        EXX
        EX AF, AF'
        HALT
MARKER: DB 0AAH
        DW 1234H
        DS 2, 0
`;

export const CONSOLE_SOURCE = `; Console example: print a prompt with OUT, then read one character with IN.
        ORG 0100H
        LD A, 'H'
        OUT (00H), A
        LD A, 'i'
        OUT (00H), A
        LD A, '?'
        OUT (00H), A
        LD A, ' '
        OUT (00H), A
        IN A, (00H)
        HALT
`;
