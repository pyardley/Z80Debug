; Table: HL reads the DB bytes. Watch A and HL.
; The arrow sits on LD A,(HL). It does not sit on the NEXT or TABLE line.
        ORG 0100H
        LD HL, TABLE
NEXT:
        LD A, (HL)
        INC HL
        OR A, A
        JR NZ, NEXT
        HALT
TABLE:
        DB 11H, 22H, 33H, 00H
