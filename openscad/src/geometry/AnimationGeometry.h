#pragma once
#include "geometry/Geometry.h"
#include "core/Value.h"
#include "geometry/linalg.h"

class ArmatureGeometry : public GeometryList {
public:
    Value animations;
    Transform3d world_matrix;
    
    ArmatureGeometry(Value anims, Transform3d w_mat = Transform3d::Identity())
        : GeometryList(Geometry::Geometries()), animations(std::move(anims)), world_matrix(w_mat) {}

    // Explicit copy constructor required because Value is move-only
    ArmatureGeometry(const ArmatureGeometry& other)
        : GeometryList(other), animations(other.animations.clone()), world_matrix(other.world_matrix) {}

    void accept(GeometryVisitor& visitor) const override {
        visitor.visit(static_cast<const GeometryList&>(*this)); 
    }
    size_t memsize() const override { return GeometryList::memsize() + sizeof(ArmatureGeometry); }
    std::unique_ptr<Geometry> copy() const override { return std::make_unique<ArmatureGeometry>(*this); }
    std::string dump() const override { return "ArmatureGeometry\n" + GeometryList::dump(); }
};

class BoneGeometry : public GeometryList {
public:
    std::string name;
    Transform3d local_matrix;
    Transform3d world_matrix;

    BoneGeometry(std::string name, Transform3d matrix, Transform3d w_mat = Transform3d::Identity())
        : GeometryList(Geometry::Geometries()), name(std::move(name)), local_matrix(matrix), world_matrix(w_mat) {}

    BoneGeometry(const BoneGeometry& other)
        : GeometryList(other), name(other.name), local_matrix(other.local_matrix), world_matrix(other.world_matrix) {}

    void accept(GeometryVisitor& visitor) const override {
        visitor.visit(static_cast<const GeometryList&>(*this)); 
    }
    size_t memsize() const override { return GeometryList::memsize() + sizeof(BoneGeometry); }
    std::unique_ptr<Geometry> copy() const override { return std::make_unique<BoneGeometry>(*this); }
    std::string dump() const override { return "BoneGeometry(" + name + ")\n" + GeometryList::dump(); }
};