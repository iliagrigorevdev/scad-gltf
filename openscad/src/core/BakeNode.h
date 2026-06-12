#pragma once
#include "core/node.h"
#include "core/ModuleInstantiation.h"

class BakeNode : public AbstractNode {
public:
    VISITABLE();
    BakeNode(const ModuleInstantiation *mi) : AbstractNode(mi) {}
    std::string name() const override { return "bake"; }

    bool bake_colors = false;
    bool bake_normals = false;
    bool bake_orm = false;
    bool bake_ao = false;
    double distance = 2.0;
    double bias = 1e-4;
    int dilation = 2;
    int resolution = 512;
    int msaa = 2;
    int index = 0;
    int ao_samples = 64;
    double ao_distance = 10.0;
};

void register_builtin_bake();
