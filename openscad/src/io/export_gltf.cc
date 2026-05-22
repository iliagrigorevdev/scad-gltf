#include "io/export.h"
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

struct PrimitiveInfo {
    int color_idx;
    std::vector<uint32_t> indices;
    std::vector<float> positions;
    std::vector<float> normals;
    float min_pos[3];
    float max_pos[3];
    std::shared_ptr<const PolySet> ps;
};

struct MeshInfo {
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

// Helper: Checks if a GeometryList implicitly contains a bone inside it.
// If it does not, we can safely bake the entire sub-tree into an absolute PolySet mesh.
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
        
        // If this node has no parent, insert it directly at the root of the scene
        if (parent_node_idx < 0) scene_nodes.push_back(node_idx);
        
        for (const auto& item : armature->getChildren()) {
            int child_idx = traverse_gltf(item.second, node_idx, model, meshes_info, bone_to_node, global_anims, C, M_accum, current_joint_idx, gltf_joints, inverse_bind_matrices, scene_nodes);
            if (child_idx >= 0) model.nodes[node_idx].children.push_back(child_idx);
        }
        return node_idx;
    }
    else if (auto bone = std::dynamic_pointer_cast<const BoneGeometry>(geom)) {
        int node_idx = model.nodes.size();
        
        // Convert OpenSCAD local matrix to glTF Y-up local matrix
        Transform3d M_gltf = C * bone->local_matrix * C.inverse();
        
        // Extract translation and rotation for glTF node placement
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

        // If this node has no parent, insert it directly at the root of the scene
        if (parent_node_idx < 0) scene_nodes.push_back(node_idx);

        // Accumulate absolute world transform for children and inverseBindMatrix calculations
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
    // Only traverse GeometryList if it hides a bone structure inside it. Otherwise, bake it into a mesh!
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
        // Flatten standard geometry + translation groups into raw PolySet vectors
        auto ps = PolySetUtils::getGeometryAsPolySet(geom);
        if (ps && !ps->vertices.empty()) {
            if (Feature::ExperimentalPredictibleOutput.is_enabled()) ps = createSortedPolySet(*ps);
            
            MeshInfo minfo;
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

                PrimitiveInfo prim;
                prim.color_idx = color_idx;
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
    acc.count = src.size() / (type == TINYGLTF_TYPE_VEC3 ? 3 : (type == TINYGLTF_TYPE_VEC4 ? 4 : (type == TINYGLTF_TYPE_MAT4 ? 16 : 1)));
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

    // 1. Traverse and generate Scene Graph
    traverse_gltf(geom, -1, model, meshes_info, bone_to_node, global_anims, C, Transform3d::Identity(), -1, gltf_joints, inverse_bind_matrices, scene_nodes);

    if (meshes_info.empty() && model.nodes.empty()) return;

    std::vector<unsigned char> bin_data;

    bool use_clearcoat = false, use_sheen = false, use_transmission = false, use_thickness = false;
    bool use_ior = false, use_emissive_strength = false, use_specular = false, use_iridescence = false;

    model.buffers.emplace_back();

    // 2. Process Skin and Inverse Bind Matrices
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
        
        bool operator<(const MaterialKey& o) const {
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

    Vector4f defBlack; defBlack[0]=0; defBlack[1]=0; defBlack[2]=0; defBlack[3]=1;
    Vector4f defWhite; defWhite[0]=1; defWhite[1]=1; defWhite[2]=1; defWhite[3]=1;

    // 3. Process Meshes
    for (const auto& minfo : meshes_info) {
        tinygltf::Mesh mesh;

        for (const auto& prim : minfo.primitives) {
            int pos_accessor_idx = append_to_bin(bin_data, prim.positions, model,
                TINYGLTF_TARGET_ARRAY_BUFFER, TINYGLTF_COMPONENT_TYPE_FLOAT, TINYGLTF_TYPE_VEC3,
                {(double)prim.min_pos[0], (double)prim.min_pos[1], (double)prim.min_pos[2]},
                {(double)prim.max_pos[0], (double)prim.max_pos[1], (double)prim.max_pos[2]});

            int norm_accessor_idx = append_to_bin(bin_data, prim.normals, model,
                TINYGLTF_TARGET_ARRAY_BUFFER, TINYGLTF_COMPONENT_TYPE_FLOAT, TINYGLTF_TYPE_VEC3);

            int joints_acc = -1;
            int weights_acc = -1;

            // Rigidly bind to joint directly modifying vertices inside the shader
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

            int idx_accessor_idx = append_to_bin(bin_data, prim.indices, model, 
                TINYGLTF_TARGET_ELEMENT_ARRAY_BUFFER, TINYGLTF_COMPONENT_TYPE_UNSIGNED_INT, TINYGLTF_TYPE_SCALAR);

            auto ps = prim.ps;
            MaterialKey mkey;

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
            gltf_prim.indices = idx_accessor_idx;
            gltf_prim.material = mat_idx;
            gltf_prim.mode = TINYGLTF_MODE_TRIANGLES;
            mesh.primitives.push_back(gltf_prim);
        }

        int mesh_idx = model.meshes.size();
        model.meshes.push_back(mesh);

        if (minfo.target_node >= 0 && minfo.joint_idx == -1) {
            if (model.nodes[minfo.target_node].mesh == -1) {
                model.nodes[minfo.target_node].mesh = mesh_idx;
            } else {
                int child_node_idx = model.nodes.size();
                tinygltf::Node child_node;
                child_node.mesh = mesh_idx;
                model.nodes.push_back(child_node);
                model.nodes[minfo.target_node].children.push_back(child_node_idx);
            }
        } else {
            int new_node_idx = model.nodes.size();
            tinygltf::Node node;
            node.mesh = mesh_idx;
            if (minfo.joint_idx != -1) {
                node.skin = 0; 
            }
            model.nodes.push_back(node);
            scene_nodes.push_back(new_node_idx);
        }
    }

    // 4. Process Animations
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

                // Pre-check if any keyframe uses translation
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
                            // Fallback to the bone's rest position if omitted in this keyframe
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
