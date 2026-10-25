; Console example: print a prompt with OUT, then read one character with IN.
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
