; Stack words. The stack grows downward.
; The row marked SP is the top word, high byte then low byte.
; EF at SP and BE at SP+1 reads BEEF. The label stays until those bytes change.
; PUSH BC labels the word BC. CALL labels the return address return.
; RET reads return → PC. POP DE of that BC word reads BC → DE.
        ORG 0100H
        LD SP, 0FF00H
        LD BC, 0BEEFH
        PUSH BC
        CALL BACK
        POP DE
        HALT
BACK:   RET
