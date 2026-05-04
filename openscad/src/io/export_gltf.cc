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
    std::shared_ptr<const PolySet> ps;
};

struct MeshInfo {
    std::vector<float> positions;
    float min_pos[3];
    float max_pos[3];
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
                  std::vector<int>& gltf_joints, std::vector<Transform3d>& inverse_bind_matrices) 
{
    if (auto armature = std::dynamic_pointer_cast<const ArmatureGeometry>(geom)) {
        if (armature->animations.type() == Value::Type::VECTOR) {
             global_anims = armature->animations.clone(); 
        }
        int node_idx = model.nodes.size();
        tinygltf::Node node;
        node.name = "Armature";
        model.nodes.push_back(node);
        
        for (const auto& item : armature->getChildren()) {
            int child_idx = traverse_gltf(item.second, node_idx, model, meshes_info, bone_to_node, global_anims, C, M_accum, current_joint_idx, gltf_joints, inverse_bind_matrices);
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

        // Accumulate absolute world transform for children and inverseBindMatrix calculations
        Transform3d next_M_accum = M_accum * bone->local_matrix;
        Transform3d inv_bind = C * next_M_accum.inverse() * C.inverse();
        
        int joint_idx = gltf_joints.size();
        gltf_joints.push_back(node_idx);
        inverse_bind_matrices.push_back(inv_bind);
        
        for (const auto& item : bone->getChildren()) {
            int child_idx = traverse_gltf(item.second, node_idx, model, meshes_info, bone_to_node, global_anims, C, next_M_accum, joint_idx, gltf_joints, inverse_bind_matrices);
            if (child_idx >= 0) model.nodes[node_idx].children.push_back(child_idx);
        }
        return node_idx;
    }
    // Only traverse GeometryList if it hides a bone structure inside it. Otherwise, bake it into a mesh!
    else if (std::dynamic_pointer_cast<const GeometryList>(geom) && contains_bone(geom)) {
        auto geomList = std::dynamic_pointer_cast<const GeometryList>(geom);
        for (const auto& item : geomList->getChildren()) {
            int child_idx = traverse_gltf(item.second, parent_node_idx, model, meshes_info, bone_to_node, global_anims, C, M_accum, current_joint_idx, gltf_joints, inverse_bind_matrices);
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
            for(int i = 0; i < 3; ++i) { minfo.min_pos[i] = FLT_MAX; minfo.max_pos[i] = -FLT_MAX; }

            for (const auto& v : ps->vertices) {
                // v is inside the bone's local mathematical space.
                // Shift it to explicit Absolute OpenSCAD world space using the true matrix accumulator
                Vector3d absolute_v = M_accum * v;
                
                // Map the absolute vectors into glTF Y-Up world space
                Vector3d gltf_v = C * absolute_v;
                
                minfo.positions.push_back(gltf_v.x());
                minfo.positions.push_back(gltf_v.y());
                minfo.positions.push_back(gltf_v.z());
                
                minfo.min_pos[0] = std::min(minfo.min_pos[0], (float)gltf_v.x());
                minfo.min_pos[1] = std::min(minfo.min_pos[1], (float)gltf_v.y());
                minfo.min_pos[2] = std::min(minfo.min_pos[2], (float)gltf_v.z());
                minfo.max_pos[0] = std::max(minfo.max_pos[0], (float)gltf_v.x());
                minfo.max_pos[1] = std::max(minfo.max_pos[1], (float)gltf_v.y());
                minfo.max_pos[2] = std::max(minfo.max_pos[2], (float)gltf_v.z());
            }

            std::map<int, PrimitiveInfo> prim_map;
            for (size_t i = 0; i < ps->indices.size(); ++i) {
                int color_idx = ps->color_indices.empty() ? -1 : ps->color_indices[i];
                auto& prim = prim_map[color_idx];
                prim.color_idx = color_idx;
                const auto& face = ps->indices[i];
                if (face.size() < 3) continue;
                for (size_t j = 1; j + 1 < face.size(); ++j) {
                    prim.indices.push_back(face[0]);
                    prim.indices.push_back(face[j]);
                    prim.indices.push_back(face[j + 1]);
                }
            }

            for (auto& kv : prim_map) {
                if (!kv.second.indices.empty()) {
                    kv.second.ps = ps;
                    minfo.primitives.push_back(std::move(kv.second));
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
    model.asset.generator = EXPORT_CREATOR;
    
    std::vector<MeshInfo> meshes_info;
    std::map<std::string, int> bone_to_node;
    Value global_anims = Value::undefined.clone();
    Transform3d C = get_z_to_y_up_matrix();
    std::vector<int> gltf_joints;
    std::vector<Transform3d> inverse_bind_matrices;

    // 1. Traverse and generate Scene Graph
    int root_idx = traverse_gltf(geom, -1, model, meshes_info, bone_to_node, global_anims, C, Transform3d::Identity(), -1, gltf_joints, inverse_bind_matrices);

    if (meshes_info.empty()) return;

    std::vector<unsigned char> bin_data;
    std::vector<int> scene_nodes;
    if (root_idx >= 0) scene_nodes.push_back(root_idx);

    bool use_clearcoat = false, use_sheen = false, use_transmission = false, use_thickness = false;

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

    // 3. Process Meshes
    for (const auto& minfo : meshes_info) {
        int pos_accessor_idx = append_to_bin(bin_data, minfo.positions, model, 
            TINYGLTF_TARGET_ARRAY_BUFFER, TINYGLTF_COMPONENT_TYPE_FLOAT, TINYGLTF_TYPE_VEC3, 
            {(double)minfo.min_pos[0], (double)minfo.min_pos[1], (double)minfo.min_pos[2]}, 
            {(double)minfo.max_pos[0], (double)minfo.max_pos[1], (double)minfo.max_pos[2]});

        int joints_acc = -1;
        int weights_acc = -1;
        
        // Rigidly bind to joint directly modifying vertices inside the shader
        if (minfo.joint_idx != -1) {
            size_t vertex_count = minfo.positions.size() / 3;
            std::vector<uint16_t> joints_data(vertex_count * 4, 0);
            std::vector<float> weights_data(vertex_count * 4, 0.0f);
            for (size_t i = 0; i < vertex_count; ++i) {
                joints_data[i * 4 + 0] = minfo.joint_idx;
                weights_data[i * 4 + 0] = 1.0f;
            }
            joints_acc = append_to_bin(bin_data, joints_data, model, TINYGLTF_TARGET_ARRAY_BUFFER, TINYGLTF_COMPONENT_TYPE_UNSIGNED_SHORT, TINYGLTF_TYPE_VEC4);
            weights_acc = append_to_bin(bin_data, weights_data, model, TINYGLTF_TARGET_ARRAY_BUFFER, TINYGLTF_COMPONENT_TYPE_FLOAT, TINYGLTF_TYPE_VEC4);
        }

        tinygltf::Mesh mesh;

        for (const auto& prim : minfo.primitives) {
            int idx_accessor_idx = append_to_bin(bin_data, prim.indices, model, 
                TINYGLTF_TARGET_ELEMENT_ARRAY_BUFFER, TINYGLTF_COMPONENT_TYPE_UNSIGNED_INT, TINYGLTF_TYPE_SCALAR);

            tinygltf::Material mat;
            mat.doubleSided = true;
            auto ps = prim.ps;

            if (prim.color_idx >= 0 && prim.color_idx < (int)ps->colors.size()) {
                auto color = ps->colors[prim.color_idx];
                int r = 255, g = 255, b = 0, a = 255;
                color.getRgba(r, g, b, a);
                mat.pbrMetallicRoughness.baseColorFactor = {(double)r/255.0, (double)g/255.0, (double)b/255.0, (double)a/255.0};

                float roughness = ps->roughnesses.empty() ? 0.0f : ps->roughnesses[prim.color_idx];
                float metalness = ps->metalnesses.empty() ? 0.0f : ps->metalnesses[prim.color_idx];
                mat.pbrMetallicRoughness.roughnessFactor = (double)roughness;
                mat.pbrMetallicRoughness.metallicFactor = (double)metalness;

                float clearcoat = ps->clearcoats.empty() ? 0.0f : ps->clearcoats[prim.color_idx];
                float clearcoatRoughness = ps->clearcoatRoughnesses.empty() ? 0.0f : ps->clearcoatRoughnesses[prim.color_idx];
                if (clearcoat > 0.0f) {
                    tinygltf::Value::Object ext;
                    ext["clearcoatFactor"] = tinygltf::Value((double)clearcoat);
                    ext["clearcoatRoughnessFactor"] = tinygltf::Value((double)clearcoatRoughness);
                    mat.extensions["KHR_materials_clearcoat"] = tinygltf::Value(ext);
                    use_clearcoat = true;
                }

                float sheen = ps->sheens.empty() ? 0.0f : ps->sheens[prim.color_idx];
                if (sheen > 0.0f) {
                    Color4f sheenColor;
                    if (ps->sheenColors.empty()) {
                        sheenColor = Vector4f(0, 0, 0, 1);
                    } else {
                        sheenColor = ps->sheenColors[prim.color_idx];
                    }
                    float sheenRoughness = ps->sheenRoughnesses.empty() ? 0.0f : ps->sheenRoughnesses[prim.color_idx];

                    tinygltf::Value::Object ext;
                    ext["sheenColorFactor"] = tinygltf::Value(tinygltf::Value::Array{
                        tinygltf::Value((double)(sheen * sheenColor.r())), 
                        tinygltf::Value((double)(sheen * sheenColor.g())), 
                        tinygltf::Value((double)(sheen * sheenColor.b()))
                    });
                    ext["sheenRoughnessFactor"] = tinygltf::Value((double)sheenRoughness);
                    mat.extensions["KHR_materials_sheen"] = tinygltf::Value(ext);
                    use_sheen = true;
                }

                float transmission = ps->transmissions.empty() ? 0.0f : ps->transmissions[prim.color_idx];
                if (transmission > 0.0f) {
                    tinygltf::Value::Object ext;
                    ext["transmissionFactor"] = tinygltf::Value((double)transmission);
                    mat.extensions["KHR_materials_transmission"] = tinygltf::Value(ext);
                    use_transmission = true;
                }

                float thickness = ps->thicknesses.empty() ? 0.0f : ps->thicknesses[prim.color_idx];
                if (thickness > 0.0f) {
                    tinygltf::Value::Object ext;
                    ext["thicknessFactor"] = tinygltf::Value((double)thickness);
                    mat.extensions["KHR_materials_volume"] = tinygltf::Value(ext);
                    use_thickness = true;
                }

                if (a < 255) mat.alphaMode = "BLEND";
            } else {
                mat.pbrMetallicRoughness.baseColorFactor = {(double)exportInfo.defaultColor.r(), (double)exportInfo.defaultColor.g(), (double)exportInfo.defaultColor.b(), (double)exportInfo.defaultColor.a()};
                mat.pbrMetallicRoughness.roughnessFactor = 0.5f;
                mat.pbrMetallicRoughness.metallicFactor = 0.0f;
                if (exportInfo.defaultColor.a() < 1.0f) mat.alphaMode = "BLEND";
            }
            
            int mat_idx = model.materials.size();
            model.materials.push_back(mat);

            tinygltf::Primitive gltf_prim;
            gltf_prim.attributes["POSITION"] = pos_accessor_idx;
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
        tinygltf::Animation gltf_anim;
        gltf_anim.name = "ArmatureAction";
        
        for (const auto& track_val : global_anims.toVector()) {
            const auto& track = track_val.toVector();
            if (track.size() < 2) continue;
            
            std::string bone_name = track[0].toStrUtf8Wrapper().toString();
            if (bone_to_node.find(bone_name) == bone_to_node.end()) continue;
            int node_idx = bone_to_node[bone_name];
            
            std::vector<float> times;
            std::vector<float> rotations;
            std::vector<float> translations;
            bool has_translation = false;

            // Pre-check if any keyframe uses translation
            for (const auto& kf_val : track[1].toVector()) {
                if (kf_val.toVector().size() > 2) {
                    has_translation = true;
                    break;
                }
            }

            float min_time = FLT_MAX, max_time = -FLT_MAX;
            
            for (const auto& kf_val : track[1].toVector()) {
                const auto& kf = kf_val.toVector();
                if (kf.empty()) continue;

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

    tinygltf::Scene scene;
    scene.nodes = scene_nodes;
    model.scenes.push_back(scene);
    model.defaultScene = 0;

    if (use_clearcoat) model.extensionsUsed.push_back("KHR_materials_clearcoat");
    if (use_sheen) model.extensionsUsed.push_back("KHR_materials_sheen");
    if (use_transmission) model.extensionsUsed.push_back("KHR_materials_transmission");
    if (use_thickness) model.extensionsUsed.push_back("KHR_materials_volume");

    model.buffers[0].data = std::move(bin_data);

    tinygltf::TinyGLTF gltf;
    if (is_glb) {
        gltf.WriteGltfSceneToStream(&model, output, false, true);
    } else {
        model.buffers[0].uri = "data:application/octet-stream;base64," + base64_encode(model.buffers[0].data.data(), model.buffers[0].data.size());
        gltf.WriteGltfSceneToStream(&model, output, true, false);
    }
}
