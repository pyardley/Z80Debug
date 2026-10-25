; Exchange: Active and Shadow swap on their own instructions.
; EX AF,AF' moves only AF. EXX moves BC, DE, and HL and leaves AF where it is.
        ORG 0100H
        LD A, 11H
        LD BC, 1111H
        LD DE, 2222H
        LD HL, 3333H
        EX AF, AF'       ; Active A is 00. Shadow A is 11. BC stays 1111.
        LD A, 0AAH       ; Active A is AA. Shadow A stays 11.
        EXX              ; Active BC, DE, and HL are 0000. Shadow keeps 1111, 2222, 3333.
        LD BC, 0BBBBH
        LD DE, 0CCCCH
        LD HL, 0DDDDH
        EX AF, AF'       ; AF swaps. BC, DE, and HL stay.
        EXX              ; BC, DE, and HL swap. AF stays.
        HALT
