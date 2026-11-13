# 解决 roadmap.json 末尾日志的冲突：两边各追加了日志时，两条都保留（先 main 的，再本分支的）
import sys
p=sys.argv[1]
L=open(p,encoding="utf8").read().split("\n")
while "<<<<<<< HEAD" in L:
    a=L.index("<<<<<<< HEAD"); m=L.index("=======",a); b=next(i for i in range(m,len(L)) if L[i].startswith(">>>>>>> "))
    ours=L[a+1:m]; theirs=L[m+1:b]
    assert all('"summary"' in x for x in ours+theirs), "不是纯日志冲突"
    date=next(x for x in reversed(L[:a]) if '"date"' in x)
    L=L[:a]+theirs+["    },","    {",date,'      "by": "Claude",']+ours+L[b+1:]
open(p,"w",encoding="utf8").write("\n".join(L))
