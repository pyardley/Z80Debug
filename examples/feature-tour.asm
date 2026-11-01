; Feature tour. Step from the first instruction through HALT.
; A comment on a load stays on that register. PC and SP keep their own bubbles.
        ORG 0100H
        LD A, 41H       ; letter A
        LD BC, 1234H    ; pair BC
        LD IX, 4000H    ; index IX
        LD IY, 8000H    ; index IY
        LD HL, 0C000H   ; buffer
        LD SP, 0FF00H
        LD (IX+03H), A
        LD A, (IX+03H)
        PUSH BC
        POP DE
        XOR A, A
        ADD A, 80H
        OR 01H
        SLA A
        SET 0, A
        LD A, 42H       ; letter B
        OUT (00H), A
        LD B, 02H
AGAIN:  DJNZ AGAIN
        HALT
