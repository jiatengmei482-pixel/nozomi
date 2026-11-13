# 冲突两边都是追加的行时：先 main 的，再本分支的
import sys
p=sys.argv[1]
L=open(p,encoding="utf8").read().split("\n")
while "<<<<<<< HEAD" in L:
    a=L.index("<<<<<<< HEAD"); m=L.index("=======",a); b=next(i for i in range(m,len(L)) if L[i].startswith(">>>>>>> "))
    L=L[:a]+L[m+1:b]+L[a+1:m]+L[b+1:]
open(p,"w",encoding="utf8").write("\n".join(L))
