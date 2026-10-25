; Console echo: print a prompt, then read one character and print it back.
; Type a character and press Queue before stepping the IN.
; IN A,(00H) runs once. If the queue is empty it returns 00H and the echo still runs.
; IN A,(01H) shows the status once: 0FFH if a character is waiting, else 00H.
        ORG 0100H
        LD A, '>'
        OUT (00H), A
        LD A, ' '
        OUT (00H), A
        IN A, (01H)
        IN A, (00H)
        OUT (00H), A
        LD A, 0AH
        OUT (00H), A
        HALT
