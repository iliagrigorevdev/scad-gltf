#include "io/export.h"

#include "core/Context.h"
#include "core/Value.h"
#include "core/Assignment.h"
#include "core/Expression.h"

#include "geometry/Geometry.h"
#include "geometry/AnimationGeometry.h"
#include "geometry/PolySet.h"
#include "geometry/PolySetUtils.h"
#include "utils/printutils.h"
#include "Feature.h"
#include "glview/ColorMap.h"
#include <ostream>
#include <map>
#include <vector>
#include <cmath>
#include <cfloat>
#include <cstring>
#include <algorithm>

#include <xatlas.h>
#define STB_IMAGE_WRITE_IMPLEMENTATION
#include <stb_image_write.h>

#define TINYGLTF_IMPLEMENTATION
#define TINYGLTF_NO_STB_IMAGE
#define TINYGLTF_NO_STB_IMAGE_WRITE
#define TINYGLTF_NO_EXTERNAL_IMAGE
#define TINYGLTF_NO_INCLUDE_JSON
#include "json/json.hpp"
#include <tiny_gltf.h>

static std::string base64_encode(const unsigned char* data, size_t len) {
    static const char chars[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string ret;
    ret.reserve(((len + 2) / 3) * 4);
    for (size_t i = 0; i < len; i += 3) {
        uint32_t val = (data[i] << 16) | (i + 1 < len ? data[i + 1] << 8 : 0) | (i + 2 < len ? data[i + 2] : 0);
        ret.push_back(chars[(val >> 18) & 0x3F]);
        ret.push_back(chars[(val >> 12) & 0x3F]);
        ret.push_back(i + 1 < len ? chars[(val >> 6) & 0x3F] : '=');
        ret.push_back(i + 2 < len ? chars[val & 0x3F] : '=');
    }
    return ret;
}

// Highly optimized evaluator that re-uses a single ContextFrame closure
struct MapEvaluator {
    ContextHandle<Context> body_context;
    const Expression* expr;
    std::shared_ptr<AssignmentList> params;

    MapEvaluator(const FunctionType& func)
        : body_context(Context::create<Context>(func.getContext())),
          expr(func.getExpr().get()),
          params(func.getParameters()) {}

    Color4f eval(const Vector3d& p3d, const Color4f& default_color) {
        Color4f c = default_color;
        try {
            if (params) {
                if (params->size() > 0 && (*params)[0]) body_context->set_variable((*params)[0]->getName(), Value(p3d.x()));
                if (params->size() > 1 && (*params)[1]) body_context->set_variable((*params)[1]->getName(), Value(p3d.y()));
                if (params->size() > 2 && (*params)[2]) body_context->set_variable((*params)[2]->getName(), Value(p3d.z()));
            }

            // *body_context returns the std::shared_ptr<const Context>
            Value res = expr->evaluate(*body_context);
            if (res.type() == Value::Type::VECTOR) {
                const auto& vec = res.toVector();
                c = Color4f(
                    (float)(vec.size() > 0 ? vec[0].toDouble() : default_color.r()),
                    (float)(vec.size() > 1 ? vec[1].toDouble() : default_color.g()),
                    (float)(vec.size() > 2 ? vec[2].toDouble() : default_color.b()),
                    (float)(vec.size() > 3 ? vec[3].toDouble() : default_color.a())
                );
            } else if (res.type() == Value::Type::NUMBER) {
                float v = (float)res.toDouble();
                c = Color4f(v, v, v, default_color.a());
            }
        } catch(...) {}
        return c;
    }
};

struct PrimitiveInfo {
    int color_idx;
    std::vector<uint32_t> indices;
    std::vector<float> positions;
    std::vector<float> normals;
    std::vector<float> tangents;
    std::vector<int> orig_v_idx;
    std::shared_ptr<const class Value> colormap;
    std::shared_ptr<const class Value> normalmap;
    std::string base_color_uri;
    std::string normal_texture_uri;
    float min_pos[3];
    float max_pos[3];
    std::shared_ptr<const PolySet> ps;
};

struct MeshInfo {
    std::string name;
    std::vector<PrimitiveInfo> primitives;
    std::shared_ptr<const PolySet> ps;
    int target_node = -1;
    int joint_idx = -1;
};

// Map Z-Up (OpenSCAD) to Y-Up (glTF)
Transform3d get_z_to_y_up_matrix() {
    Transform3d C = Transform3d::Identity();
    C.matrix() << 1, 0, 0, 0,
                  0, 0, 1, 0,
                  0,-1, 0, 0,
                  0, 0, 0, 1;
    return C;
}

bool contains_bone(const std::shared_ptr<const Geometry>& geom) {
    if (std::dynamic_pointer_cast<const BoneGeometry>(geom)) return true;
    if (auto gl = std::dynamic_pointer_cast<const GeometryList>(geom)) {
        for (const auto& item : gl->getChildren()) {
            if (contains_bone(item.second)) return true;
        }
    }
    return false;
}

int traverse_gltf(const std::shared_ptr<const Geometry>& geom, int parent_node_idx,
                  tinygltf::Model& model, std::vector<MeshInfo>& meshes_info,
                  std::map<std::string, int>& bone_to_node, Value& global_anims,
                  Transform3d C, Transform3d M_accum, int current_joint_idx,
                  std::vector<int>& gltf_joints, std::vector<Transform3d>& inverse_bind_matrices,
                  std::vector<int>& scene_nodes)
{
    if (auto armature = std::dynamic_pointer_cast<const ArmatureGeometry>(geom)) {
        if (armature->animations.type() == Value::Type::VECTOR) {
             global_anims = armature->animations.clone();
        }
        int node_idx = model.nodes.size();
        tinygltf::Node node;
        node.name = "Armature";
        model.nodes.push_back(node);

        if (parent_node_idx < 0) scene_nodes.push_back(node_idx);

        for (const auto& item : armature->getChildren()) {
            int child_idx = traverse_gltf(item.second, node_idx, model, meshes_info, bone_to_node, global_anims, C, M_accum, current_joint_idx, gltf_joints, inverse_bind_matrices, scene_nodes);
            if (child_idx >= 0) model.nodes[node_idx].children.push_back(child_idx);
        }
        return node_idx;
    }
    else if (auto bone = std::dynamic_pointer_cast<const BoneGeometry>(geom)) {
        int node_idx = model.nodes.size();

        Transform3d M_gltf = C * bone->local_matrix * C.inverse();
        Eigen::Matrix3d R_and_S = M_gltf.linear();
        Eigen::Vector3d s(R_and_S.col(0).norm(), R_and_S.col(1).norm(), R_and_S.col(2).norm());
        Eigen::Matrix3d R;
        for(int i=0; i<3; ++i) R.col(i) = R_and_S.col(i) / (s[i] > 1e-8 ? s[i] : 1.0);
        if (R.determinant() < 0) { s.x() *= -1; R.col(0) *= -1; }

        Eigen::Vector3d t = M_gltf.translation();
        Eigen::Quaterniond q(R);

        tinygltf::Node node;
        node.name = bone->name;
        node.translation = {t.x(), t.y(), t.z()};
        node.rotation = {q.x(), q.y(), q.z(), q.w()};
        node.scale = {s.x(), s.y(), s.z()};
        model.nodes.push_back(node);
        bone_to_node[bone->name] = node_idx;

        if (parent_node_idx < 0) scene_nodes.push_back(node_idx);

        Transform3d next_M_accum = M_accum * bone->local_matrix;
        Transform3d inv_bind = C * next_M_accum.inverse() * C.inverse();

        int joint_idx = gltf_joints.size();
        gltf_joints.push_back(node_idx);
        inverse_bind_matrices.push_back(inv_bind);

        for (const auto& item : bone->getChildren()) {
            int child_idx = traverse_gltf(item.second, node_idx, model, meshes_info, bone_to_node, global_anims, C, next_M_accum, joint_idx, gltf_joints, inverse_bind_matrices, scene_nodes);
            if (child_idx >= 0) model.nodes[node_idx].children.push_back(child_idx);
        }
        return node_idx;
    }
    else if (std::dynamic_pointer_cast<const GeometryList>(geom) && contains_bone(geom)) {
        auto geomList = std::dynamic_pointer_cast<const GeometryList>(geom);
        for (const auto& item : geomList->getChildren()) {
            int child_idx = traverse_gltf(item.second, parent_node_idx, model, meshes_info, bone_to_node, global_anims, C, M_accum, current_joint_idx, gltf_joints, inverse_bind_matrices, scene_nodes);
            if (child_idx >= 0 && parent_node_idx >= 0) {
                model.nodes[parent_node_idx].children.push_back(child_idx);
            }
        }
        return -1;
    }
    else {
        auto ps = PolySetUtils::getGeometryAsPolySet(geom);
        if (ps && !ps->vertices.empty()) {
            if (Feature::ExperimentalPredictibleOutput.is_enabled()) ps = createSortedPolySet(*ps);

            MeshInfo minfo;
            if (parent_node_idx >= 0 && parent_node_idx < (int)model.nodes.size()) {
                const std::string& p_name = model.nodes[parent_node_idx].name;
                if (!p_name.empty()) minfo.name = p_name;
            }
            minfo.ps = ps;
            minfo.target_node = parent_node_idx;
            minfo.joint_idx = current_joint_idx;

            std::map<int, std::vector<int>> prim_faces;
            for (size_t i = 0; i < ps->indices.size(); ++i) {
                int color_idx = ps->color_indices.empty() ? -1 : ps->color_indices[i];
                prim_faces[color_idx].push_back(i);
            }

            for (auto& kv : prim_faces) {
                int color_idx = kv.first;
                const auto& face_indices = kv.second;
                if (face_indices.empty()) continue;

                float autoSmoothAngle = 0.0f;
                if (color_idx >= 0 && color_idx < (int)ps->autoSmoothAngles.size()) {
                    autoSmoothAngle = ps->autoSmoothAngles[color_idx];
                }

                std::shared_ptr<const Value> colormap = nullptr;
                if (color_idx >= 0 && color_idx < ps->colormaps.size()) {
                    colormap = ps->colormaps[color_idx];
                }

                std::shared_ptr<const Value> normalmap = nullptr;
                if (color_idx >= 0 && color_idx < ps->normalmaps.size()) {
                    normalmap = ps->normalmaps[color_idx];
                }

                PrimitiveInfo prim;
                prim.color_idx = color_idx;
                prim.colormap = colormap;
                prim.normalmap = normalmap;
                prim.ps = ps;
                for(int i=0; i<3; ++i) { prim.min_pos[i] = FLT_MAX; prim.max_pos[i] = -FLT_MAX; }

                std::vector<Vector3d> gltf_vertices(ps->vertices.size());
                for (size_t i = 0; i < ps->vertices.size(); ++i) {
                    gltf_vertices[i] = C * M_accum * ps->vertices[i];
                }

                std::vector<Vector3d> face_normals(face_indices.size());
                for (size_t i = 0; i < face_indices.size(); ++i) {
                    const auto& f = ps->indices[face_indices[i]];
                    if (f.size() < 3) continue;
                    Vector3d p0 = gltf_vertices[f[0]];
                    Vector3d p1 = gltf_vertices[f[1]];
                    Vector3d p2 = gltf_vertices[f[2]];
                    Vector3d n = (p1 - p0).cross(p2 - p0);
                    if (n.norm() > 1e-8) n.normalize();
                    else n = Vector3d(0, 1, 0);
                    face_normals[i] = n;
                }

                std::vector<std::vector<int>> vertex_to_faces(ps->vertices.size());
                for (size_t i = 0; i < face_indices.size(); ++i) {
                    const auto& f = ps->indices[face_indices[i]];
                    for (int v_idx : f) {
                        vertex_to_faces[v_idx].push_back(i);
                    }
                }

                float cos_threshold = std::cos(autoSmoothAngle * M_PI / 180.0f);

                struct VertKey {
                    int v_idx;
                    Vector3d normal;
                    bool operator<(const VertKey& o) const {
                        if (v_idx != o.v_idx) return v_idx < o.v_idx;
                        if (normal.x() != o.normal.x()) return normal.x() < o.normal.x();
                        if (normal.y() != o.normal.y()) return normal.y() < o.normal.y();
                        return normal.z() < o.normal.z();
                    }
                };

                std::map<VertKey, uint32_t> vert_to_idx;

                auto add_vertex = [&](int v_idx, const Vector3d& n) -> uint32_t {
                    VertKey key{v_idx, n};
                    auto it = vert_to_idx.find(key);
                    if (it != vert_to_idx.end()) return it->second;

                    uint32_t new_idx = prim.positions.size() / 3;
                    Vector3d p = gltf_vertices[v_idx];
                    prim.positions.push_back((float)p.x());
                    prim.positions.push_back((float)p.y());
                    prim.positions.push_back((float)p.z());
                    prim.normals.push_back((float)n.x());
                    prim.normals.push_back((float)n.y());
                    prim.normals.push_back((float)n.z());
                    prim.orig_v_idx.push_back(v_idx);

                    prim.min_pos[0] = std::min(prim.min_pos[0], (float)p.x());
                    prim.min_pos[1] = std::min(prim.min_pos[1], (float)p.y());
                    prim.min_pos[2] = std::min(prim.min_pos[2], (float)p.z());
                    prim.max_pos[0] = std::max(prim.max_pos[0], (float)p.x());
                    prim.max_pos[1] = std::max(prim.max_pos[1], (float)p.y());
                    prim.max_pos[2] = std::max(prim.max_pos[2], (float)p.z());

                    vert_to_idx[key] = new_idx;
                    return new_idx;
                };

                for (size_t i = 0; i < face_indices.size(); ++i) {
                    const auto& f = ps->indices[face_indices[i]];
                    if (f.size() < 3) continue;

                    Vector3d fn = face_normals[i];

                    for (size_t j = 1; j + 1 < f.size(); ++j) {
                        int tri[3] = {f[0], f[j], f[j+1]};

                        for (int k = 0; k < 3; ++k) {
                            int v = tri[k];
                            Vector3d n = fn;

                            if (autoSmoothAngle > 0.0f) {
                                Vector3d sum_n = Vector3d::Zero();
                                for (int adj_f_idx : vertex_to_faces[v]) {
                                    Vector3d adj_fn = face_normals[adj_f_idx];
                                    if (fn.dot(adj_fn) >= cos_threshold - 1e-5) {
                                        sum_n += adj_fn;
                                    }
                                }
                                if (sum_n.norm() > 1e-8) n = sum_n.normalized();
                            }

                            prim.indices.push_back(add_vertex(v, n));
                        }
                    }
                }

                if (!prim.indices.empty()) {
                    minfo.primitives.push_back(std::move(prim));
                }
            }
            if (!minfo.primitives.empty()) meshes_info.push_back(std::move(minfo));
        }
        return -1;
    }
}

template<typename T>
int append_to_bin(std::vector<unsigned char>& bin_data, const std::vector<T>& src, tinygltf::Model& model,
                   int target, int componentType, int type, const std::vector<double>& min_val = {}, const std::vector<double>& max_val = {})
{
    size_t offset = bin_data.size();
    size_t length = src.size() * sizeof(T);
    bin_data.resize(offset + length);
    memcpy(bin_data.data() + offset, src.data(), length);

    tinygltf::BufferView bv;
    bv.buffer = 0;
    bv.byteOffset = offset;
    bv.byteLength = length;
    if (target != 0) bv.target = target;
    int bv_idx = model.bufferViews.size();
    model.bufferViews.push_back(bv);

    tinygltf::Accessor acc;
    acc.bufferView = bv_idx;
    acc.byteOffset = 0;
    acc.componentType = componentType;
    acc.count = src.size() / (type == TINYGLTF_TYPE_VEC3 ? 3 : (type == TINYGLTF_TYPE_VEC4 ? 4 : (type == TINYGLTF_TYPE_MAT4 ? 16 : (type == TINYGLTF_TYPE_VEC2 ? 2 : 1))));
    acc.type = type;
    if (!min_val.empty()) acc.minValues = min_val;
    if (!max_val.empty()) acc.maxValues = max_val;

    int acc_idx = model.accessors.size();
    model.accessors.push_back(acc);
    return acc_idx;
}

void export_gltf(const std::shared_ptr<const Geometry>& geom, std::ostream& output, bool is_glb, const ExportInfo& exportInfo)
{
    tinygltf::Model model;
    model.asset.version = "2.0";
    model.asset.generator = "OpenSCAD GLTF (https://github.com/iliagrigorevdev/openscad-gltf-wasm)";

    std::vector<MeshInfo> meshes_info;
    std::map<std::string, int> bone_to_node;
    Value global_anims = Value::undefined.clone();
    Transform3d C = get_z_to_y_up_matrix();
    std::vector<int> gltf_joints;
    std::vector<Transform3d> inverse_bind_matrices;
    std::vector<int> scene_nodes;

    traverse_gltf(geom, -1, model, meshes_info, bone_to_node, global_anims, C, Transform3d::Identity(), -1, gltf_joints, inverse_bind_matrices, scene_nodes);

    if (meshes_info.empty() && model.nodes.empty()) return;

    std::vector<unsigned char> bin_data;

    bool use_clearcoat = false, use_sheen = false, use_transmission = false, use_thickness = false;
    bool use_ior = false, use_emissive_strength = false, use_specular = false, use_iridescence = false;

    model.buffers.emplace_back();

    if (!gltf_joints.empty()) {
        std::vector<float> inv_bind_floats;
        inv_bind_floats.reserve(inverse_bind_matrices.size() * 16);
        for (const auto& mat : inverse_bind_matrices) {
            for (int c = 0; c < 4; ++c) {
                for (int r = 0; r < 4; ++r) {
                    inv_bind_floats.push_back((float)mat.matrix()(r, c));
                }
            }
        }
        int inv_bind_acc = append_to_bin(bin_data, inv_bind_floats, model, 0, TINYGLTF_COMPONENT_TYPE_FLOAT, TINYGLTF_TYPE_MAT4);

        tinygltf::Skin skin;
        skin.name = "ArmatureSkin";
        skin.joints = gltf_joints;
        skin.inverseBindMatrices = inv_bind_acc;
        if (!gltf_joints.empty()) skin.skeleton = gltf_joints[0];
        model.skins.push_back(skin);
    }

    struct MaterialKey {
        Color4f color;
        float roughness, metalness, clearcoat, clearcoatRoughness, sheen;
        Color4f sheenColor;
        float sheenRoughness, transmission, thickness;
        Color4f attenuationColor;
        float attenuationDistance, ior;
        Color4f emissive;
        float emissiveIntensity;
        Color4f specularColor;
        float specularIntensity, iridescence, iridescenceIOR;
        std::string base_color_uri;
        std::string normal_texture_uri;

        bool operator<(const MaterialKey& o) const {
            if (base_color_uri != o.base_color_uri) return base_color_uri < o.base_color_uri;
            if (normal_texture_uri != o.normal_texture_uri) return normal_texture_uri < o.normal_texture_uri;
            if (color.r() != o.color.r()) return color.r() < o.color.r();
            if (color.g() != o.color.g()) return color.g() < o.color.g();
            if (color.b() != o.color.b()) return color.b() < o.color.b();
            if (color.a() != o.color.a()) return color.a() < o.color.a();
            if (roughness != o.roughness) return roughness < o.roughness;
            if (metalness != o.metalness) return metalness < o.metalness;
            if (clearcoat != o.clearcoat) return clearcoat < o.clearcoat;
            if (clearcoatRoughness != o.clearcoatRoughness) return clearcoatRoughness < o.clearcoatRoughness;
            if (sheen != o.sheen) return sheen < o.sheen;
            if (sheenColor.r() != o.sheenColor.r()) return sheenColor.r() < o.sheenColor.r();
            if (sheenColor.g() != o.sheenColor.g()) return sheenColor.g() < o.sheenColor.g();
            if (sheenColor.b() != o.sheenColor.b()) return sheenColor.b() < o.sheenColor.b();
            if (sheenColor.a() != o.sheenColor.a()) return sheenColor.a() < o.sheenColor.a();
            if (sheenRoughness != o.sheenRoughness) return sheenRoughness < o.sheenRoughness;
            if (transmission != o.transmission) return transmission < o.transmission;
            if (thickness != o.thickness) return thickness < o.thickness;
            if (attenuationColor.r() != o.attenuationColor.r()) return attenuationColor.r() < o.attenuationColor.r();
            if (attenuationColor.g() != o.attenuationColor.g()) return attenuationColor.g() < o.attenuationColor.g();
            if (attenuationColor.b() != o.attenuationColor.b()) return attenuationColor.b() < o.attenuationColor.b();
            if (attenuationColor.a() != o.attenuationColor.a()) return attenuationColor.a() < o.attenuationColor.a();
            if (attenuationDistance != o.attenuationDistance) return attenuationDistance < o.attenuationDistance;
            if (ior != o.ior) return ior < o.ior;
            if (emissive.r() != o.emissive.r()) return emissive.r() < o.emissive.r();
            if (emissive.g() != o.emissive.g()) return emissive.g() < o.emissive.g();
            if (emissive.b() != o.emissive.b()) return emissive.b() < o.emissive.b();
            if (emissive.a() != o.emissive.a()) return emissive.a() < o.emissive.a();
            if (emissiveIntensity != o.emissiveIntensity) return emissiveIntensity < o.emissiveIntensity;
            if (specularColor.r() != o.specularColor.r()) return specularColor.r() < o.specularColor.r();
            if (specularColor.g() != o.specularColor.g()) return specularColor.g() < o.specularColor.g();
            if (specularColor.b() != o.specularColor.b()) return specularColor.b() < o.specularColor.b();
            if (specularColor.a() != o.specularColor.a()) return specularColor.a() < o.specularColor.a();
            if (specularIntensity != o.specularIntensity) return specularIntensity < o.specularIntensity;
            if (iridescence != o.iridescence) return iridescence < o.iridescence;
            return iridescenceIOR < o.iridescenceIOR;
        }
    };

    std::map<MaterialKey, int> material_cache;
    std::map<std::string, int> image_cache;

    Vector4f defBlack; defBlack[0]=0; defBlack[1]=0; defBlack[2]=0; defBlack[3]=1;
    Vector4f defWhite; defWhite[0]=1; defWhite[1]=1; defWhite[2]=1; defWhite[3]=1;

    for (auto& minfo : meshes_info) {
        std::vector<int> prim_to_atlas(minfo.primitives.size(), -1);
        int num_atlas_meshes = 0;
        for (size_t p_idx = 0; p_idx < minfo.primitives.size(); ++p_idx) {
            const auto& prim = minfo.primitives[p_idx];
            if ((prim.colormap && prim.colormap->type() == Value::Type::FUNCTION) ||
                (prim.normalmap && prim.normalmap->type() == Value::Type::FUNCTION)) {
                prim_to_atlas[p_idx] = num_atlas_meshes++;
            }
        }

        xatlas::Atlas* atlas = nullptr;
        std::string mesh_base_color_uri;
        std::string mesh_normal_texture_uri;
        std::map<int, std::vector<Vector4d>> a_idx_to_tangents;

        if (num_atlas_meshes > 0) {
            atlas = xatlas::Create();
            for (size_t p_idx = 0; p_idx < minfo.primitives.size(); ++p_idx) {
                if (prim_to_atlas[p_idx] == -1) continue;
                const auto& prim = minfo.primitives[p_idx];
                xatlas::MeshDecl meshDecl;
                meshDecl.vertexCount = prim.positions.size() / 3;
                meshDecl.vertexPositionData = prim.positions.data();
                meshDecl.vertexPositionStride = 3 * sizeof(float);
                meshDecl.indexCount = prim.indices.size();
                meshDecl.indexData = prim.indices.data();
                meshDecl.indexFormat = xatlas::IndexFormat::UInt32;
                xatlas::AddMesh(atlas, meshDecl, num_atlas_meshes);
            }

            xatlas::PackOptions packOptions;
            packOptions.resolution = 0; // 0 to auto-fit all into 1 atlas
            packOptions.padding = 2;
            xatlas::Generate(atlas, xatlas::ChartOptions(), packOptions);

            uint32_t width = atlas->width;
            uint32_t height = atlas->height;
            if (width > 0 && height > 0 && atlas->atlasCount > 0) {
                bool has_colormap = false;
                bool has_normalmap = false;
                for (size_t p_idx = 0; p_idx < minfo.primitives.size(); ++p_idx) {
                    if (prim_to_atlas[p_idx] != -1) {
                        if (minfo.primitives[p_idx].colormap && minfo.primitives[p_idx].colormap->type() == Value::Type::FUNCTION) has_colormap = true;
                        if (minfo.primitives[p_idx].normalmap && minfo.primitives[p_idx].normalmap->type() == Value::Type::FUNCTION) has_normalmap = true;
                    }
                }

                std::vector<uint8_t> pixels;
                std::vector<uint8_t> npixels;
                if (has_colormap) pixels.resize(width * height * 4, 0);
                if (has_normalmap) npixels.resize(width * height * 4, 0);

                for (size_t p_idx = 0; p_idx < minfo.primitives.size(); ++p_idx) {
                    int a_idx = prim_to_atlas[p_idx];
                    if (a_idx == -1) continue;

                    const xatlas::Mesh& xmesh = atlas->meshes[a_idx];
                    const auto& prim = minfo.primitives[p_idx];

                    std::unique_ptr<MapEvaluator> ceval;
                    if (has_colormap && prim.colormap && prim.colormap->type() == Value::Type::FUNCTION) ceval = std::make_unique<MapEvaluator>(prim.colormap->toFunction());

                    std::unique_ptr<MapEvaluator> neval;
                    if (has_normalmap && prim.normalmap && prim.normalmap->type() == Value::Type::FUNCTION) neval = std::make_unique<MapEvaluator>(prim.normalmap->toFunction());

                    auto get_pos = [&](uint32_t orig_idx) -> Vector3d {
                        int v_idx = prim.orig_v_idx[orig_idx];
                        return prim.ps->vertices[v_idx];
                    };
                    auto get_gltf_pos = [&](uint32_t orig_idx) -> Vector3d {
                        return Vector3d(prim.positions[orig_idx*3+0], prim.positions[orig_idx*3+1], prim.positions[orig_idx*3+2]);
                    };
                    auto get_gltf_norm = [&](uint32_t orig_idx) -> Vector3d {
                        return Vector3d(prim.normals[orig_idx*3+0], prim.normals[orig_idx*3+1], prim.normals[orig_idx*3+2]);
                    };

                    std::vector<Vector3d> tan1(xmesh.vertexCount, Vector3d::Zero());
                    std::vector<Vector3d> tan2(xmesh.vertexCount, Vector3d::Zero());

                    for (uint32_t f = 0; f < xmesh.indexCount / 3; ++f) {
                        uint32_t i0 = xmesh.indexArray[f*3 + 0];
                        uint32_t i1 = xmesh.indexArray[f*3 + 1];
                        uint32_t i2 = xmesh.indexArray[f*3 + 2];
                        const xatlas::Vertex& v0 = xmesh.vertexArray[i0];
                        const xatlas::Vertex& v1 = xmesh.vertexArray[i1];
                        const xatlas::Vertex& v2 = xmesh.vertexArray[i2];
                        Vector3d gltf_p0 = get_gltf_pos(v0.xref);
                        Vector3d gltf_p1 = get_gltf_pos(v1.xref);
                        Vector3d gltf_p2 = get_gltf_pos(v2.xref);
                        float nuv0x = v0.uv[0] / (float)width, nuv0y = v0.uv[1] / (float)height;
                        float nuv1x = v1.uv[0] / (float)width, nuv1y = v1.uv[1] / (float)height;
                        float nuv2x = v2.uv[0] / (float)width, nuv2y = v2.uv[1] / (float)height;

                        Vector3d dp1 = gltf_p1 - gltf_p0;
                        Vector3d dp2 = gltf_p2 - gltf_p0;
                        float du1 = nuv1x - nuv0x;
                        float dv1 = nuv1y - nuv0y;
                        float du2 = nuv2x - nuv0x;
                        float dv2 = nuv2y - nuv0y;

                        float det = du1 * dv2 - du2 * dv1;
                        float r = (std::abs(det) > 1e-8f) ? 1.0f / det : 0.0f;
                        Vector3d sdir = (dp1 * dv2 - dp2 * dv1) * r;
                        Vector3d tdir = (dp2 * du1 - dp1 * du2) * r;

                        tan1[i0] += sdir; tan1[i1] += sdir; tan1[i2] += sdir;
                        tan2[i0] += tdir; tan2[i1] += tdir; tan2[i2] += tdir;
                    }

                    std::vector<Vector4d> tangents(xmesh.vertexCount);
                    for (uint32_t i = 0; i < xmesh.vertexCount; ++i) {
                        Vector3d n = get_gltf_norm(xmesh.vertexArray[i].xref);
                        Vector3d t = tan1[i];
                        Vector3d t_ortho = (t - n * n.dot(t));
                        if (t_ortho.norm() > 1e-8f) {
                            t_ortho.normalize();
                        } else {
                            t_ortho = Vector3d(1, 0, 0); // fallback
                        }
                        float w = (n.cross(t_ortho).dot(tan2[i]) < 0.0f) ? -1.0f : 1.0f;
                        tangents[i] = Vector4d(t_ortho.x(), t_ortho.y(), t_ortho.z(), w);
                    }
                    a_idx_to_tangents[a_idx] = tangents;

                    for (uint32_t f = 0; f < xmesh.indexCount / 3; ++f) {
                        uint32_t i0 = xmesh.indexArray[f*3 + 0];
                        uint32_t i1 = xmesh.indexArray[f*3 + 1];
                        uint32_t i2 = xmesh.indexArray[f*3 + 2];

                        const xatlas::Vertex& v0 = xmesh.vertexArray[i0];
                        const xatlas::Vertex& v1 = xmesh.vertexArray[i1];
                        const xatlas::Vertex& v2 = xmesh.vertexArray[i2];

                        Vector3d p0 = get_pos(v0.xref);
                        Vector3d p1 = get_pos(v1.xref);
                        Vector3d p2 = get_pos(v2.xref);

                        Vector3d n0 = get_gltf_norm(v0.xref);
                        Vector3d n1 = get_gltf_norm(v1.xref);
                        Vector3d n2 = get_gltf_norm(v2.xref);

                        Vector4d t0 = a_idx_to_tangents[a_idx][i0];
                        Vector4d t1 = a_idx_to_tangents[a_idx][i1];
                        Vector4d t2 = a_idx_to_tangents[a_idx][i2];

                        float uv0x = v0.uv[0], uv0y = v0.uv[1];
                        float uv1x = v1.uv[0], uv1y = v1.uv[1];
                        float uv2x = v2.uv[0], uv2y = v2.uv[1];

                        int min_x = std::max(0, (int)std::floor(std::min({uv0x, uv1x, uv2x})));
                        int max_x = std::min((int)width - 1, (int)std::ceil(std::max({uv0x, uv1x, uv2x})));
                        int min_y = std::max(0, (int)std::floor(std::min({uv0y, uv1y, uv2y})));
                        int max_y = std::min((int)height - 1, (int)std::ceil(std::max({uv0y, uv1y, uv2y})));

                        for (int y = min_y; y <= max_y; ++y) {
                            for (int x = min_x; x <= max_x; ++x) {
                                float px = x + 0.5f;
                                float py = y + 0.5f;

                                float det = (uv1y - uv2y)*(uv0x - uv2x) + (uv2x - uv1x)*(uv0y - uv2y);
                                if (std::abs(det) < 1e-8f) continue;
                                float u = ((uv1y - uv2y)*(px - uv2x) + (uv2x - uv1x)*(py - uv2y)) / det;
                                float v = ((uv2y - uv0y)*(px - uv2x) + (uv0x - uv2x)*(py - uv2y)) / det;
                                float w = 1.0f - u - v;

                                if (u >= -1e-4f && v >= -1e-4f && w >= -1e-4f) {
                                    Vector3d p3d = u * p0 + v * p1 + w * p2;

                                    int pixel_idx = (y * width + x) * 4;

                                    if (has_colormap) {
                                        if (ceval) {
                                            Color4f c = ceval->eval(p3d, Color4f(1, 1, 1, 1));
                                            pixels[pixel_idx + 0] = (uint8_t)std::max(0, std::min(255, (int)(c.r() * 255.0f)));
                                            pixels[pixel_idx + 1] = (uint8_t)std::max(0, std::min(255, (int)(c.g() * 255.0f)));
                                            pixels[pixel_idx + 2] = (uint8_t)std::max(0, std::min(255, (int)(c.b() * 255.0f)));
                                            pixels[pixel_idx + 3] = (uint8_t)std::max(0, std::min(255, (int)(c.a() * 255.0f)));
                                        } else {
                                            pixels[pixel_idx + 0] = 255;
                                            pixels[pixel_idx + 1] = 255;
                                            pixels[pixel_idx + 2] = 255;
                                            pixels[pixel_idx + 3] = 255;
                                        }
                                    }

                                    if (has_normalmap) {
                                        if (neval) {
                                            Color4f n = neval->eval(p3d, Color4f(0.5f, 0.5f, 1.0f, 1.0f));

                                            Vector3d N_interp = (u * n0 + v * n1 + w * n2).normalized();
                                            Vector3d T_interp = (u * t0.head<3>() + v * t1.head<3>() + w * t2.head<3>()).normalized();
                                            float w_interp = t0.w(); // xatlas islands don't fold over, w is uniform per-triangle

                                            Vector3d T_uv = (T_interp - N_interp * N_interp.dot(T_interp));
                                            if (T_uv.norm() > 1e-8f) {
                                                T_uv.normalize();
                                            } else {
                                                T_uv = Vector3d(0, 1, 0).cross(N_interp);
                                                if (T_uv.norm() < 1e-4f) T_uv = Vector3d(1, 0, 0).cross(N_interp);
                                                T_uv.normalize();
                                            }

                                            Vector3d B_uv = N_interp.cross(T_uv).normalized() * w_interp;

                                            Vector3d T_can = Vector3d(0, 1, 0).cross(N_interp);
                                            if (T_can.norm() < 1e-4f) T_can = Vector3d(1, 0, 0).cross(N_interp);
                                            T_can.normalize();
                                            Vector3d B_can = N_interp.cross(T_can).normalized();

                                            float dx = n.r() * 2.0f - 1.0f;
                                            float dy = n.g() * 2.0f - 1.0f;
                                            float dz = n.b() * 2.0f - 1.0f;

                                            Vector3d N_ws = (T_can * dx + B_can * dy + N_interp * dz).normalized();

                                            float dx_uv = N_ws.dot(T_uv);
                                            float dy_uv = -N_ws.dot(B_uv); // Invert for OpenGL convention (+Y is Up, +V is Down)
                                            float dz_uv = N_ws.dot(N_interp);

                                            npixels[pixel_idx + 0] = (uint8_t)std::max(0, std::min(255, (int)((dx_uv * 0.5f + 0.5f) * 255.0f)));
                                            npixels[pixel_idx + 1] = (uint8_t)std::max(0, std::min(255, (int)((dy_uv * 0.5f + 0.5f) * 255.0f)));
                                            npixels[pixel_idx + 2] = (uint8_t)std::max(0, std::min(255, (int)((dz_uv * 0.5f + 0.5f) * 255.0f)));
                                            npixels[pixel_idx + 3] = (uint8_t)std::max(0, std::min(255, (int)(n.a() * 255.0f)));
                                        } else {
                                            npixels[pixel_idx + 0] = 128;
                                            npixels[pixel_idx + 1] = 128;
                                            npixels[pixel_idx + 2] = 255;
                                            npixels[pixel_idx + 3] = 255;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                auto dilate_and_encode = [&](std::vector<uint8_t>& px, uint8_t defR, uint8_t defG, uint8_t defB) -> std::string {
                    for (int iter = 0; iter < 8; ++iter) {
                        std::vector<uint8_t> dilated_pixels = px;
                        int changed = 0;
                        for (uint32_t y = 0; y < height; ++y) {
                            for (uint32_t x = 0; x < width; ++x) {
                                int p_idx = (y * width + x) * 4;
                                if (px[p_idx + 3] == 0) {
                                    int r=0, g=0, b=0, a=0, count=0;
                                    for (int dy = -1; dy <= 1; ++dy) {
                                        for (int dx = -1; dx <= 1; ++dx) {
                                            if (dx == 0 && dy == 0) continue;
                                            int nx = x + dx;
                                            int ny = y + dy;
                                            if (nx >= 0 && nx < (int)width && ny >= 0 && ny < (int)height) {
                                                int n_idx = (ny * width + nx) * 4;
                                                if (px[n_idx + 3] > 0) {
                                                    r += px[n_idx + 0];
                                                    g += px[n_idx + 1];
                                                    b += px[n_idx + 2];
                                                    a += px[n_idx + 3];
                                                    count++;
                                                }
                                            }
                                        }
                                    }
                                    if (count > 0) {
                                        dilated_pixels[p_idx + 0] = r / count;
                                        dilated_pixels[p_idx + 1] = g / count;
                                        dilated_pixels[p_idx + 2] = b / count;
                                        dilated_pixels[p_idx + 3] = 255;
                                        changed++;
                                    }
                                }
                            }
                        }
                        px = std::move(dilated_pixels);
                        if (changed == 0) break;
                    }
                    for (size_t i = 0; i < px.size(); i += 4) {
                        if (px[i + 3] == 0) {
                            px[i + 0] = defR;
                            px[i + 1] = defG;
                            px[i + 2] = defB;
                            px[i + 3] = 255;
                        }
                    }
                    std::vector<unsigned char> png_data;
                    auto write_func = [](void *context, void *data, int size) {
                        auto *vec = static_cast<std::vector<unsigned char>*>(context);
                        vec->insert(vec->end(), static_cast<unsigned char*>(data), static_cast<unsigned char*>(data) + size);
                    };
                    stbi_write_png_to_func(write_func, &png_data, width, height, 4, px.data(), width * 4);
                    return "data:image/png;base64," + base64_encode(png_data.data(), png_data.size());
                };

                if (has_colormap) mesh_base_color_uri = dilate_and_encode(pixels, 128, 128, 128);
                if (has_normalmap) mesh_normal_texture_uri = dilate_and_encode(npixels, 128, 128, 255);
            }
        }

        tinygltf::Mesh mesh;
        if (!minfo.name.empty()) mesh.name = minfo.name;

        for (size_t p_idx = 0; p_idx < minfo.primitives.size(); ++p_idx) {
            auto& prim = minfo.primitives[p_idx];
            int a_idx = atlas ? prim_to_atlas[p_idx] : -1;

            if (a_idx != -1) {
                prim.base_color_uri = mesh_base_color_uri;
                prim.normal_texture_uri = mesh_normal_texture_uri;
            } else {
                prim.base_color_uri = "";
                prim.normal_texture_uri = "";
            }

            std::vector<float> uvs;
            std::vector<float> tangents;

            if (atlas && a_idx != -1) {
                const xatlas::Mesh& xmesh = atlas->meshes[a_idx];
                std::vector<float> new_pos, new_norm;
                std::vector<uint32_t> new_ind;
                new_pos.reserve(xmesh.vertexCount * 3);
                new_norm.reserve(xmesh.vertexCount * 3);
                uvs.reserve(xmesh.vertexCount * 2);
                tangents.reserve(xmesh.vertexCount * 4);
                new_ind.reserve(xmesh.indexCount);

                for (uint32_t i = 0; i < xmesh.vertexCount; ++i) {
                    const xatlas::Vertex& v = xmesh.vertexArray[i];
                    new_pos.push_back(prim.positions[v.xref * 3 + 0]);
                    new_pos.push_back(prim.positions[v.xref * 3 + 1]);
                    new_pos.push_back(prim.positions[v.xref * 3 + 2]);
                    new_norm.push_back(prim.normals[v.xref * 3 + 0]);
                    new_norm.push_back(prim.normals[v.xref * 3 + 1]);
                    new_norm.push_back(prim.normals[v.xref * 3 + 2]);
                    uvs.push_back(v.uv[0] / (float)atlas->width);
                    uvs.push_back(v.uv[1] / (float)atlas->height);

                    if (a_idx_to_tangents.count(a_idx)) {
                        Vector4d t = a_idx_to_tangents[a_idx][i];
                        tangents.push_back((float)t.x());
                        tangents.push_back((float)t.y());
                        tangents.push_back((float)t.z());
                        tangents.push_back((float)t.w());
                    }
                }

                for (uint32_t i = 0; i < xmesh.indexCount; ++i) {
                    new_ind.push_back(xmesh.indexArray[i]);
                }

                prim.positions = std::move(new_pos);
                prim.normals = std::move(new_norm);
                prim.indices = std::move(new_ind);
                prim.tangents = std::move(tangents);
            }

            int pos_accessor_idx = append_to_bin(bin_data, prim.positions, model,
                TINYGLTF_TARGET_ARRAY_BUFFER, TINYGLTF_COMPONENT_TYPE_FLOAT, TINYGLTF_TYPE_VEC3,
                {(double)prim.min_pos[0], (double)prim.min_pos[1], (double)prim.min_pos[2]},
                {(double)prim.max_pos[0], (double)prim.max_pos[1], (double)prim.max_pos[2]});

            int norm_accessor_idx = append_to_bin(bin_data, prim.normals, model,
                TINYGLTF_TARGET_ARRAY_BUFFER, TINYGLTF_COMPONENT_TYPE_FLOAT, TINYGLTF_TYPE_VEC3);

            int joints_acc = -1;
            int weights_acc = -1;

            if (minfo.joint_idx != -1) {
                size_t vertex_count = prim.positions.size() / 3;
                std::vector<uint16_t> joints_data(vertex_count * 4, 0);
                std::vector<float> weights_data(vertex_count * 4, 0.0f);
                for (size_t i = 0; i < vertex_count; ++i) {
                    joints_data[i * 4 + 0] = minfo.joint_idx;
                    weights_data[i * 4 + 0] = 1.0f;
                }
                joints_acc = append_to_bin(bin_data, joints_data, model, TINYGLTF_TARGET_ARRAY_BUFFER, TINYGLTF_COMPONENT_TYPE_UNSIGNED_SHORT, TINYGLTF_TYPE_VEC4);
                weights_acc = append_to_bin(bin_data, weights_data, model, TINYGLTF_TARGET_ARRAY_BUFFER, TINYGLTF_COMPONENT_TYPE_FLOAT, TINYGLTF_TYPE_VEC4);
            }

            int uv_accessor_idx = -1;
            if (!uvs.empty()) {
                uv_accessor_idx = append_to_bin(bin_data, uvs, model,
                    TINYGLTF_TARGET_ARRAY_BUFFER, TINYGLTF_COMPONENT_TYPE_FLOAT, TINYGLTF_TYPE_VEC2);
            }

            int tangent_accessor_idx = -1;
            if (!prim.tangents.empty()) {
                tangent_accessor_idx = append_to_bin(bin_data, prim.tangents, model,
                    TINYGLTF_TARGET_ARRAY_BUFFER, TINYGLTF_COMPONENT_TYPE_FLOAT, TINYGLTF_TYPE_VEC4);
            }

            int idx_accessor_idx = append_to_bin(bin_data, prim.indices, model,
                TINYGLTF_TARGET_ELEMENT_ARRAY_BUFFER, TINYGLTF_COMPONENT_TYPE_UNSIGNED_INT, TINYGLTF_TYPE_SCALAR);

            auto ps = prim.ps;
            MaterialKey mkey;
            mkey.base_color_uri = prim.base_color_uri;
            mkey.normal_texture_uri = prim.normal_texture_uri;

            if (prim.color_idx >= 0 && prim.color_idx < (int)ps->colors.size()) {
                mkey.color = ps->colors[prim.color_idx];
                mkey.roughness = ps->roughnesses.empty() ? 1.0f : ps->roughnesses[prim.color_idx];
                mkey.metalness = ps->metalnesses.empty() ? 0.0f : ps->metalnesses[prim.color_idx];
                mkey.clearcoat = ps->clearcoats.empty() ? 0.0f : ps->clearcoats[prim.color_idx];
                mkey.clearcoatRoughness = ps->clearcoatRoughnesses.empty() ? 0.0f : ps->clearcoatRoughnesses[prim.color_idx];
                mkey.sheen = ps->sheens.empty() ? 0.0f : ps->sheens[prim.color_idx];
                mkey.sheenColor = ps->sheenColors.empty() ? defBlack : ps->sheenColors[prim.color_idx];
                mkey.sheenRoughness = ps->sheenRoughnesses.empty() ? 0.0f : ps->sheenRoughnesses[prim.color_idx];
                mkey.transmission = ps->transmissions.empty() ? 0.0f : ps->transmissions[prim.color_idx];
                mkey.thickness = ps->thicknesses.empty() ? 0.0f : ps->thicknesses[prim.color_idx];
                mkey.attenuationColor = ps->attenuationColors.empty() ? defWhite : ps->attenuationColors[prim.color_idx];
                mkey.attenuationDistance = ps->attenuationDistances.empty() ? 0.0f : ps->attenuationDistances[prim.color_idx];
                mkey.ior = ps->iors.empty() ? 1.5f : ps->iors[prim.color_idx];
                mkey.emissive = ps->emissives.empty() ? defBlack : ps->emissives[prim.color_idx];
                mkey.emissiveIntensity = ps->emissiveIntensities.empty() ? 1.0f : ps->emissiveIntensities[prim.color_idx];
                mkey.specularColor = ps->specularColors.empty() ? defWhite : ps->specularColors[prim.color_idx];
                mkey.specularIntensity = ps->specularIntensities.empty() ? 1.0f : ps->specularIntensities[prim.color_idx];
                mkey.iridescence = ps->iridescences.empty() ? 0.0f : ps->iridescences[prim.color_idx];
                mkey.iridescenceIOR = ps->iridescenceIORs.empty() ? 1.3f : ps->iridescenceIORs[prim.color_idx];
            } else {
                mkey.color = exportInfo.defaultColor;
                mkey.roughness = 1.0f;
                mkey.metalness = 0.0f;
                mkey.clearcoat = 0.0f;
                mkey.clearcoatRoughness = 0.0f;
                mkey.sheen = 0.0f;
                mkey.sheenColor = defBlack;
                mkey.sheenRoughness = 0.0f;
                mkey.transmission = 0.0f;
                mkey.thickness = 0.0f;
                mkey.attenuationColor = defWhite;
                mkey.attenuationDistance = 0.0f;
                mkey.ior = 1.5f;
                mkey.emissive = defBlack;
                mkey.emissiveIntensity = 1.0f;
                mkey.specularColor = defWhite;
                mkey.specularIntensity = 1.0f;
                mkey.iridescence = 0.0f;
                mkey.iridescenceIOR = 1.3f;
            }

            int mat_idx = -1;
            auto it = material_cache.find(mkey);
            if (it != material_cache.end()) {
                mat_idx = it->second;
            } else {
                tinygltf::Material mat;
                mat.doubleSided = true;

                mat.pbrMetallicRoughness.baseColorFactor = {(double)mkey.color.r(), (double)mkey.color.g(), (double)mkey.color.b(), (double)mkey.color.a()};
                mat.pbrMetallicRoughness.roughnessFactor = (double)mkey.roughness;
                mat.pbrMetallicRoughness.metallicFactor = (double)mkey.metalness;

                if (!mkey.base_color_uri.empty()) {
                    auto img_it = image_cache.find(mkey.base_color_uri);
                    if (img_it != image_cache.end()) {
                        mat.pbrMetallicRoughness.baseColorTexture.index = img_it->second;
                    } else {
                        tinygltf::Image img;
                        img.uri = mkey.base_color_uri;
                        int img_idx = model.images.size();
                        model.images.push_back(img);

                        tinygltf::Texture tex;
                        tex.source = img_idx;
                        int tex_idx = model.textures.size();
                        model.textures.push_back(tex);

                        mat.pbrMetallicRoughness.baseColorTexture.index = tex_idx;
                        image_cache[mkey.base_color_uri] = tex_idx;
                    }
                }

                if (!mkey.normal_texture_uri.empty()) {
                    auto img_it = image_cache.find(mkey.normal_texture_uri);
                    if (img_it != image_cache.end()) {
                        mat.normalTexture.index = img_it->second;
                    } else {
                        tinygltf::Image img;
                        img.uri = mkey.normal_texture_uri;
                        int img_idx = model.images.size();
                        model.images.push_back(img);

                        tinygltf::Texture tex;
                        tex.source = img_idx;
                        int tex_idx = model.textures.size();
                        model.textures.push_back(tex);

                        mat.normalTexture.index = tex_idx;
                        image_cache[mkey.normal_texture_uri] = tex_idx;
                    }
                }

                if (mkey.clearcoat > 0.0f) {
                    tinygltf::Value::Object ext;
                    ext["clearcoatFactor"] = tinygltf::Value((double)mkey.clearcoat);
                    ext["clearcoatRoughnessFactor"] = tinygltf::Value((double)mkey.clearcoatRoughness);
                    mat.extensions["KHR_materials_clearcoat"] = tinygltf::Value(ext);
                    use_clearcoat = true;
                }

                if (mkey.sheen > 0.0f) {
                    tinygltf::Value::Object ext;
                    ext["sheenColorFactor"] = tinygltf::Value(tinygltf::Value::Array{
                        tinygltf::Value((double)(mkey.sheen * mkey.sheenColor.r())),
                        tinygltf::Value((double)(mkey.sheen * mkey.sheenColor.g())),
                        tinygltf::Value((double)(mkey.sheen * mkey.sheenColor.b()))
                    });
                    ext["sheenRoughnessFactor"] = tinygltf::Value((double)mkey.sheenRoughness);
                    mat.extensions["KHR_materials_sheen"] = tinygltf::Value(ext);
                    use_sheen = true;
                }

                if (mkey.transmission > 0.0f) {
                    tinygltf::Value::Object ext;
                    ext["transmissionFactor"] = tinygltf::Value((double)mkey.transmission);
                    mat.extensions["KHR_materials_transmission"] = tinygltf::Value(ext);
                    use_transmission = true;
                }

                if (mkey.thickness > 0.0f || mkey.attenuationDistance > 0.0f ||
                    mkey.attenuationColor.r() != 1.0f || mkey.attenuationColor.g() != 1.0f || mkey.attenuationColor.b() != 1.0f) {
                    tinygltf::Value::Object ext;
                    if (mkey.thickness > 0.0f) ext["thicknessFactor"] = tinygltf::Value((double)mkey.thickness);
                    if (mkey.attenuationDistance > 0.0f) ext["attenuationDistance"] = tinygltf::Value((double)mkey.attenuationDistance);
                    if (mkey.attenuationColor.r() != 1.0f || mkey.attenuationColor.g() != 1.0f || mkey.attenuationColor.b() != 1.0f) {
                        ext["attenuationColor"] = tinygltf::Value(tinygltf::Value::Array{
                            tinygltf::Value((double)mkey.attenuationColor.r()),
                            tinygltf::Value((double)mkey.attenuationColor.g()),
                            tinygltf::Value((double)mkey.attenuationColor.b())
                        });
                    }
                    mat.extensions["KHR_materials_volume"] = tinygltf::Value(ext);
                    use_thickness = true;
                }

                if (mkey.ior != 1.5f) {
                    tinygltf::Value::Object ext;
                    ext["ior"] = tinygltf::Value((double)mkey.ior);
                    mat.extensions["KHR_materials_ior"] = tinygltf::Value(ext);
                    use_ior = true;
                }

                if (mkey.emissive.r() > 0.0f || mkey.emissive.g() > 0.0f || mkey.emissive.b() > 0.0f) {
                    mat.emissiveFactor = {(double)mkey.emissive.r(), (double)mkey.emissive.g(), (double)mkey.emissive.b()};
                    if (mkey.emissiveIntensity != 1.0f) {
                        tinygltf::Value::Object ext;
                        ext["emissiveStrength"] = tinygltf::Value((double)mkey.emissiveIntensity);
                        mat.extensions["KHR_materials_emissive_strength"] = tinygltf::Value(ext);
                        use_emissive_strength = true;
                    }
                }

                if (mkey.specularIntensity != 1.0f || mkey.specularColor.r() != 1.0f || mkey.specularColor.g() != 1.0f || mkey.specularColor.b() != 1.0f) {
                    tinygltf::Value::Object ext;
                    ext["specularFactor"] = tinygltf::Value((double)mkey.specularIntensity);
                    if (mkey.specularColor.r() != 1.0f || mkey.specularColor.g() != 1.0f || mkey.specularColor.b() != 1.0f) {
                        ext["specularColorFactor"] = tinygltf::Value(tinygltf::Value::Array{
                            tinygltf::Value((double)mkey.specularColor.r()),
                            tinygltf::Value((double)mkey.specularColor.g()),
                            tinygltf::Value((double)mkey.specularColor.b())
                        });
                    }
                    mat.extensions["KHR_materials_specular"] = tinygltf::Value(ext);
                    use_specular = true;
                }

                if (mkey.iridescence > 0.0f) {
                    tinygltf::Value::Object ext;
                    ext["iridescenceFactor"] = tinygltf::Value((double)mkey.iridescence);
                    ext["iridescenceIor"] = tinygltf::Value((double)mkey.iridescenceIOR);
                    mat.extensions["KHR_materials_iridescence"] = tinygltf::Value(ext);
                    use_iridescence = true;
                }

                if (mkey.color.a() < 1.0f) mat.alphaMode = "BLEND";

                mat_idx = model.materials.size();
                model.materials.push_back(mat);
                material_cache[mkey] = mat_idx;
            }

            tinygltf::Primitive gltf_prim;
            gltf_prim.attributes["POSITION"] = pos_accessor_idx;
            gltf_prim.attributes["NORMAL"] = norm_accessor_idx;
            if (joints_acc != -1) gltf_prim.attributes["JOINTS_0"] = joints_acc;
            if (weights_acc != -1) gltf_prim.attributes["WEIGHTS_0"] = weights_acc;
            if (uv_accessor_idx != -1) gltf_prim.attributes["TEXCOORD_0"] = uv_accessor_idx;
            if (tangent_accessor_idx != -1) gltf_prim.attributes["TANGENT"] = tangent_accessor_idx;
            gltf_prim.indices = idx_accessor_idx;
            gltf_prim.material = mat_idx;
            gltf_prim.mode = TINYGLTF_MODE_TRIANGLES;
            mesh.primitives.push_back(gltf_prim);
        }

        if (atlas) {
            xatlas::Destroy(atlas);
        }

        int mesh_idx = model.meshes.size();
        model.meshes.push_back(mesh);

        if (minfo.target_node >= 0 && minfo.joint_idx == -1) {
            if (model.nodes[minfo.target_node].mesh == -1) {
                model.nodes[minfo.target_node].mesh = mesh_idx;
            } else {
                int child_node_idx = model.nodes.size();
                tinygltf::Node child_node;
                if (!minfo.name.empty()) child_node.name = minfo.name;
                child_node.mesh = mesh_idx;
                model.nodes.push_back(child_node);
                model.nodes[minfo.target_node].children.push_back(child_node_idx);
            }
        } else {
            int new_node_idx = model.nodes.size();
            tinygltf::Node node;
            if (!minfo.name.empty()) node.name = minfo.name;
            node.mesh = mesh_idx;
            if (minfo.joint_idx != -1) {
                node.skin = 0;
            }
            model.nodes.push_back(node);
            scene_nodes.push_back(new_node_idx);
        }
    }

    if (global_anims.type() == Value::Type::VECTOR) {
        for (const auto& anim_val : global_anims.toVector()) {
            if (anim_val.type() != Value::Type::VECTOR) continue;
            const auto& anim = anim_val.toVector();
            if (anim.size() < 2 || anim[0].type() != Value::Type::STRING || anim[1].type() != Value::Type::VECTOR) continue;

            std::string anim_name = anim[0].toStrUtf8Wrapper().toString();
            const auto& tracks = anim[1].toVector();

            tinygltf::Animation gltf_anim;
            gltf_anim.name = anim_name;

            for (const auto& track_val : tracks) {
                if (track_val.type() != Value::Type::VECTOR) continue;
                const auto& track = track_val.toVector();
                if (track.size() < 2 || track[0].type() != Value::Type::STRING || track[1].type() != Value::Type::VECTOR) continue;

                std::string bone_name = track[0].toStrUtf8Wrapper().toString();
                if (bone_to_node.find(bone_name) == bone_to_node.end()) continue;
                int node_idx = bone_to_node[bone_name];

                std::vector<float> times;
                std::vector<float> rotations;
                std::vector<float> translations;
                bool has_translation = false;

                for (const auto& kf_val : track[1].toVector()) {
                    if (kf_val.type() != Value::Type::VECTOR) continue;
                    if (kf_val.toVector().size() > 2) {
                        has_translation = true;
                        break;
                    }
                }

                float min_time = FLT_MAX, max_time = -FLT_MAX;

                for (const auto& kf_val : track[1].toVector()) {
                    if (kf_val.type() != Value::Type::VECTOR) continue;
                    const auto& kf = kf_val.toVector();
                    if (kf.empty() || kf[0].type() != Value::Type::NUMBER) continue;

                    float t = kf[0].toDouble();
                    times.push_back(t);
                    min_time = std::min(min_time, t);
                    max_time = std::max(max_time, t);

                    double rx=0, ry=0, rz=0;
                    if (kf.size() > 1) {
                        kf[1].getVec3(rx, ry, rz);
                    }

                    Transform3d rot = Transform3d::Identity();
                    rot.rotate(Eigen::AngleAxisd(rz * M_PI/180.0, Vector3d::UnitZ()) *
                               Eigen::AngleAxisd(ry * M_PI/180.0, Vector3d::UnitY()) *
                               Eigen::AngleAxisd(rx * M_PI/180.0, Vector3d::UnitX()));

                    Transform3d rot_gltf = C * rot * C.inverse();
                    Eigen::Quaterniond q(rot_gltf.rotation());

                    rotations.push_back(q.x()); rotations.push_back(q.y());
                    rotations.push_back(q.z()); rotations.push_back(q.w());

                    if (has_translation) {
                        if (kf.size() > 2) {
                            double tx=0, ty=0, tz=0;
                            kf[2].getVec3(tx, ty, tz);
                            Vector3d trans_gltf = C * Vector3d(tx, ty, tz);
                            translations.push_back(trans_gltf.x());
                            translations.push_back(trans_gltf.y());
                            translations.push_back(trans_gltf.z());
                        } else {
                            translations.push_back(model.nodes[node_idx].translation[0]);
                            translations.push_back(model.nodes[node_idx].translation[1]);
                            translations.push_back(model.nodes[node_idx].translation[2]);
                        }
                    }
                }

                if (times.empty()) continue;

                int time_acc_idx = append_to_bin(bin_data, times, model, 0, TINYGLTF_COMPONENT_TYPE_FLOAT, TINYGLTF_TYPE_SCALAR, {(double)min_time}, {(double)max_time});
                int rot_acc_idx = append_to_bin(bin_data, rotations, model, 0, TINYGLTF_COMPONENT_TYPE_FLOAT, TINYGLTF_TYPE_VEC4);

                int sampler_idx = gltf_anim.samplers.size();
                tinygltf::AnimationSampler sampler;
                sampler.input = time_acc_idx;
                sampler.output = rot_acc_idx;
                sampler.interpolation = "LINEAR";
                gltf_anim.samplers.push_back(sampler);

                tinygltf::AnimationChannel channel;
                channel.sampler = sampler_idx;
                channel.target_node = node_idx;
                channel.target_path = "rotation";
                gltf_anim.channels.push_back(channel);

                if (has_translation) {
                    int trans_acc_idx = append_to_bin(bin_data, translations, model, 0, TINYGLTF_COMPONENT_TYPE_FLOAT, TINYGLTF_TYPE_VEC3);

                    int t_sampler_idx = gltf_anim.samplers.size();
                    tinygltf::AnimationSampler t_sampler;
                    t_sampler.input = time_acc_idx;
                    t_sampler.output = trans_acc_idx;
                    t_sampler.interpolation = "LINEAR";
                    gltf_anim.samplers.push_back(t_sampler);

                    tinygltf::AnimationChannel t_channel;
                    t_channel.sampler = t_sampler_idx;
                    t_channel.target_node = node_idx;
                    t_channel.target_path = "translation";
                    gltf_anim.channels.push_back(t_channel);
                }
            }
            if (!gltf_anim.channels.empty()) model.animations.push_back(gltf_anim);
        }
    }

    tinygltf::Scene scene;
    scene.nodes = scene_nodes;
    model.scenes.push_back(scene);
    model.defaultScene = 0;

    if (use_clearcoat) model.extensionsUsed.push_back("KHR_materials_clearcoat");
    if (use_sheen) model.extensionsUsed.push_back("KHR_materials_sheen");
    if (use_transmission) model.extensionsUsed.push_back("KHR_materials_transmission");
    if (use_thickness) model.extensionsUsed.push_back("KHR_materials_volume");
    if (use_ior) model.extensionsUsed.push_back("KHR_materials_ior");
    if (use_emissive_strength) model.extensionsUsed.push_back("KHR_materials_emissive_strength");
    if (use_specular) model.extensionsUsed.push_back("KHR_materials_specular");
    if (use_iridescence) model.extensionsUsed.push_back("KHR_materials_iridescence");

    model.buffers[0].data = std::move(bin_data);

    tinygltf::TinyGLTF gltf;
    if (is_glb) {
        gltf.WriteGltfSceneToStream(&model, output, false, true);
    } else {
        model.buffers[0].uri = "data:application/octet-stream;base64," + base64_encode(model.buffers[0].data.data(), model.buffers[0].data.size());
        gltf.WriteGltfSceneToStream(&model, output, true, false);
    }
}
