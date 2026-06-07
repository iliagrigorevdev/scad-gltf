// src/core/BakeNode.h
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
    double distance = 2.0;
    double bias = 1e-4;
    int dilation = 8;
};

void register_builtin_bake();
