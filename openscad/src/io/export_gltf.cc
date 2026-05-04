#include "io/export.h"
#include "geometry/Geometry.h"
#include "geometry/AnimationGeometry.h"
#include "geometry/PolySet.h"
#include "geometry/PolySetUtils.h"
#include "utils/printutils.h"
#include "json/json.hpp"
#include "Feature.h"
#include "glview/ColorMap.h"
#include <ostream>
#include <map>
#include <vector>
#include <cfloat>
#include <cstring>
#include <algorithm>

using json = nlohmann::json;

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

int traverse_gltf(const std::shared_ptr<const Geometry>& geom, int parent_node_idx, 
                  json& nodes_json, std::vector<MeshInfo>& meshes_info, 
                  std::map<std::string, int>& bone_to_node, Value& global_anims, Transform3d C) 
{
    if (auto armature = std::dynamic_pointer_cast<const ArmatureGeometry>(geom)) {
        if (armature->animations.type() == Value::Type::VECTOR) {
             global_anims = armature->animations.clone(); 
        }
        int node_idx = nodes_json.size();
        nodes_json.push_back({{"name", "Armature"}});
        
        for (const auto& item : armature->getChildren()) {
            int child_idx = traverse_gltf(item.second, node_idx, nodes_json, meshes_info, bone_to_node, global_anims, C);
            if (child_idx >= 0) nodes_json[node_idx]["children"].push_back(child_idx);
        }
        return node_idx;
    }
    else if (auto bone = std::dynamic_pointer_cast<const BoneGeometry>(geom)) {
        int node_idx = nodes_json.size();
        
        // Convert OpenSCAD local matrix to glTF Y-up local matrix
        Transform3d M_gltf = C * bone->local_matrix * C.inverse();
        Eigen::Vector3d t = M_gltf.translation();
        Eigen::Quaterniond q(M_gltf.rotation());
        
        nodes_json.push_back({
            {"name", bone->name},
            {"translation", {t.x(), t.y(), t.z()}},
            {"rotation", {q.x(), q.y(), q.z(), q.w()}}
        });
        bone_to_node[bone->name] = node_idx;
        
        for (const auto& item : bone->getChildren()) {
            int child_idx = traverse_gltf(item.second, node_idx, nodes_json, meshes_info, bone_to_node, global_anims, C);
            if (child_idx >= 0) nodes_json[node_idx]["children"].push_back(child_idx);
        }
        return node_idx;
    }
    else if (auto geomList = std::dynamic_pointer_cast<const GeometryList>(geom)) {
        for (const auto& item : geomList->getChildren()) {
            int child_idx = traverse_gltf(item.second, parent_node_idx, nodes_json, meshes_info, bone_to_node, global_anims, C);
            if (child_idx >= 0 && parent_node_idx >= 0) {
                if (!nodes_json[parent_node_idx].contains("children")) nodes_json[parent_node_idx]["children"] = json::array();
                nodes_json[parent_node_idx]["children"].push_back(child_idx);
            }
        }
        return -1;
    }
    else {
        auto ps = PolySetUtils::getGeometryAsPolySet(geom);
        if (ps && !ps->vertices.empty()) {
            if (Feature::ExperimentalPredictibleOutput.is_enabled()) ps = createSortedPolySet(*ps);
            
            MeshInfo minfo;
            minfo.ps = ps;
            minfo.target_node = parent_node_idx;
            for(int i = 0; i < 3; ++i) { minfo.min_pos[i] = FLT_MAX; minfo.max_pos[i] = -FLT_MAX; }

            for (const auto& v : ps->vertices) {
                // The geometry vertices are ALREADY in local bone space!
                // We just mathematically map Z-Up coordinates to Y-Up
                Vector3d gltf_v = C * v;
                
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
void append_to_bin(std::vector<unsigned char>& bin_data, const std::vector<T>& src, json& bufferViews, json& accessors, 
                   int target, int componentType, const std::string& type, json min_val = nullptr, json max_val = nullptr) 
{
    size_t offset = bin_data.size();
    size_t length = src.size() * sizeof(T);
    bin_data.resize(offset + length);
    memcpy(bin_data.data() + offset, src.data(), length);

    int bv_idx = bufferViews.size();
    json bv = {{"buffer", 0}, {"byteOffset", offset}, {"byteLength", length}};
    if (target != 0) bv["target"] = target;
    bufferViews.push_back(bv);

    json acc = {{"bufferView", bv_idx}, {"byteOffset", 0}, {"componentType", componentType}, {"count", src.size() / (type == "VEC3" ? 3 : (type == "VEC4" ? 4 : 1))}, {"type", type}};
    if (min_val != nullptr) acc["min"] = min_val;
    if (max_val != nullptr) acc["max"] = max_val;
    accessors.push_back(acc);
}

void export_gltf(const std::shared_ptr<const Geometry>& geom, std::ostream& output, bool is_glb, const ExportInfo& exportInfo)
{
    std::vector<MeshInfo> meshes_info;
    json nodes_json = json::array();
    std::map<std::string, int> bone_to_node;
    Value global_anims = Value::undefined.clone();
    Transform3d C = get_z_to_y_up_matrix();

    // 1. Traverse and generate Scene Graph
    int root_idx = traverse_gltf(geom, -1, nodes_json, meshes_info, bone_to_node, global_anims, C);

    if (meshes_info.empty()) return;

    std::vector<unsigned char> bin_data;
    json meshes_json = json::array();
    json materials_json = json::array();
    json accessors = json::array();
    json bufferViews = json::array();
    json animations_json = json::array();
    std::vector<int> scene_nodes;
    if (root_idx >= 0) scene_nodes.push_back(root_idx);

    bool use_clearcoat = false, use_sheen = false, use_transmission = false, use_thickness = false;

    // 2. Process Meshes
    for (const auto& minfo : meshes_info) {
        int pos_accessor_idx = accessors.size();
        append_to_bin(bin_data, minfo.positions, bufferViews, accessors, 34962, 5126, "VEC3", 
                      {minfo.min_pos[0], minfo.min_pos[1], minfo.min_pos[2]}, 
                      {minfo.max_pos[0], minfo.max_pos[1], minfo.max_pos[2]});

        json primitives_json = json::array();
        for (const auto& prim : minfo.primitives) {
            int idx_accessor_idx = accessors.size();
            append_to_bin(bin_data, prim.indices, bufferViews, accessors, 34963, 5125, "SCALAR");

            int mat_idx = materials_json.size();
            json mat = {{"pbrMetallicRoughness", json::object()}};
            auto ps = prim.ps;

            if (prim.color_idx >= 0 && prim.color_idx < (int)ps->colors.size()) {
                auto color = ps->colors[prim.color_idx];
                int r = 255, g = 255, b = 0, a = 255;
                color.getRgba(r, g, b, a);
                mat["pbrMetallicRoughness"]["baseColorFactor"] = {r/255.0f, g/255.0f, b/255.0f, a/255.0f};

                float roughness = ps->roughnesses.empty() ? 0.0f : ps->roughnesses[prim.color_idx];
                float metalness = ps->metalnesses.empty() ? 0.0f : ps->metalnesses[prim.color_idx];
                mat["pbrMetallicRoughness"]["roughnessFactor"] = roughness;
                mat["pbrMetallicRoughness"]["metallicFactor"] = metalness;

                float clearcoat = ps->clearcoats.empty() ? 0.0f : ps->clearcoats[prim.color_idx];
                float clearcoatRoughness = ps->clearcoatRoughnesses.empty() ? 0.0f : ps->clearcoatRoughnesses[prim.color_idx];
                if (clearcoat > 0.0f) {
                    mat["extensions"]["KHR_materials_clearcoat"] = {
                        {"clearcoatFactor", clearcoat},
                        {"clearcoatRoughnessFactor", clearcoatRoughness}
                    };
                    use_clearcoat = true;
                }

                float sheen = ps->sheens.empty() ? 0.0f : ps->sheens[prim.color_idx];
                if (sheen > 0.0f) {
                    Color4f sheenColor;
                    if (ps->sheenColors.empty()) {
                        Vector4f v; v[0]=0; v[1]=0; v[2]=0; v[3]=1;
                        sheenColor = v;
                    } else {
                        sheenColor = ps->sheenColors[prim.color_idx];
                    }
                    float sheenRoughness = ps->sheenRoughnesses.empty() ? 0.0f : ps->sheenRoughnesses[prim.color_idx];

                    mat["extensions"]["KHR_materials_sheen"] = {
                        {"sheenColorFactor", {sheen * sheenColor.r(), sheen * sheenColor.g(), sheen * sheenColor.b()}},
                        {"sheenRoughnessFactor", sheenRoughness}
                    };
                    use_sheen = true;
                }

                float transmission = ps->transmissions.empty() ? 0.0f : ps->transmissions[prim.color_idx];
                if (transmission > 0.0f) {
                    mat["extensions"]["KHR_materials_transmission"] = {
                        {"transmissionFactor", transmission}
                    };
                    use_transmission = true;
                }

                float thickness = ps->thicknesses.empty() ? 0.0f : ps->thicknesses[prim.color_idx];
                if (thickness > 0.0f) {
                    mat["extensions"]["KHR_materials_volume"] = {
                        {"thicknessFactor", thickness}
                    };
                    use_thickness = true;
                }

                if (a < 255) mat["alphaMode"] = "BLEND";
            } else {
                mat["pbrMetallicRoughness"]["baseColorFactor"] = {exportInfo.defaultColor.r(), exportInfo.defaultColor.g(), exportInfo.defaultColor.b(), exportInfo.defaultColor.a()};
                mat["pbrMetallicRoughness"]["roughnessFactor"] = 0.5f;
                mat["pbrMetallicRoughness"]["metallicFactor"] = 0.0f;
                if (exportInfo.defaultColor.a() < 1.0f) mat["alphaMode"] = "BLEND";
            }
            mat["doubleSided"] = true;
            materials_json.push_back(mat);

            primitives_json.push_back({ {"attributes", {{"POSITION", pos_accessor_idx}}}, {"indices", idx_accessor_idx}, {"material", mat_idx} });
        }

        int mesh_idx = meshes_json.size();
        meshes_json.push_back({ {"primitives", primitives_json} });

        if (minfo.target_node >= 0) {
            nodes_json[minfo.target_node]["mesh"] = mesh_idx;
        } else {
            int new_node_idx = nodes_json.size();
            nodes_json.push_back({ {"mesh", mesh_idx} });
            scene_nodes.push_back(new_node_idx);
        }
    }

    // 3. Process Animations
    if (global_anims.type() == Value::Type::VECTOR) {
        json gltf_anim = {{"name", "ArmatureAction"}, {"channels", json::array()}, {"samplers", json::array()}};
        
        for (const auto& track_val : global_anims.toVector()) {
            const auto& track = track_val.toVector();
            if (track.size() < 2) continue;
            
            std::string bone_name = track[0].toStrUtf8Wrapper().toString();
            if (bone_to_node.find(bone_name) == bone_to_node.end()) continue;
            int node_idx = bone_to_node[bone_name];
            
            std::vector<float> times;
            std::vector<float> rotations;
            float min_time = FLT_MAX, max_time = -FLT_MAX;
            
            for (const auto& kf_val : track[1].toVector()) {
                const auto& kf = kf_val.toVector();
                float t = kf[0].toDouble();
                times.push_back(t);
                min_time = std::min(min_time, t);
                max_time = std::max(max_time, t);
                
                double rx=0, ry=0, rz=0;
                kf[1].getVec3(rx, ry, rz);
                
                Transform3d rot = Transform3d::Identity();
                rot.rotate(Eigen::AngleAxisd(rz * M_PI/180.0, Vector3d::UnitZ()) * 
                           Eigen::AngleAxisd(ry * M_PI/180.0, Vector3d::UnitY()) * 
                           Eigen::AngleAxisd(rx * M_PI/180.0, Vector3d::UnitX()));
                           
                Transform3d rot_gltf = C * rot * C.inverse();
                Eigen::Quaterniond q(rot_gltf.rotation());
                
                rotations.push_back(q.x()); rotations.push_back(q.y());
                rotations.push_back(q.z()); rotations.push_back(q.w());
            }
            
            int time_acc_idx = accessors.size();
            append_to_bin(bin_data, times, bufferViews, accessors, 0, 5126, "SCALAR", {min_time}, {max_time});
            
            int rot_acc_idx = accessors.size();
            append_to_bin(bin_data, rotations, bufferViews, accessors, 0, 5126, "VEC4");
            
            int sampler_idx = gltf_anim["samplers"].size();
            gltf_anim["samplers"].push_back({{"input", time_acc_idx}, {"output", rot_acc_idx}, {"interpolation", "LINEAR"}});
            gltf_anim["channels"].push_back({{"sampler", sampler_idx}, {"target", {{"node", node_idx}, {"path", "rotation"}}}});
        }
        if (!gltf_anim["channels"].empty()) animations_json.push_back(gltf_anim);
    }

    json j;
    j["asset"] = {{"version", "2.0"}, {"generator", EXPORT_CREATOR}};
    j["scene"] = 0;
    j["scenes"] = {{ {"nodes", scene_nodes} }};
    j["nodes"] = nodes_json;
    j["meshes"] = meshes_json;
    j["materials"] = materials_json;
    j["accessors"] = accessors;
    j["bufferViews"] = bufferViews;
    if (!animations_json.empty()) j["animations"] = animations_json;

    std::vector<std::string> extensionsUsed;
    if (use_clearcoat) extensionsUsed.push_back("KHR_materials_clearcoat");
    if (use_sheen) extensionsUsed.push_back("KHR_materials_sheen");
    if (use_transmission) extensionsUsed.push_back("KHR_materials_transmission");
    if (use_thickness) extensionsUsed.push_back("KHR_materials_volume");

    if (!extensionsUsed.empty()) {
        j["extensionsUsed"] = extensionsUsed;
    }

    // Write output
    if (is_glb) {
        while (bin_data.size() % 4 != 0) bin_data.push_back(0x00);
        j["buffers"] = {{ {"byteLength", bin_data.size()} }};
        std::string json_str = j.dump();
        while (json_str.size() % 4 != 0) json_str.push_back(' ');

        uint32_t magic = 0x46546C67, version = 2;
        uint32_t length = 12 + 8 + json_str.size() + 8 + bin_data.size();
        output.write((const char*)&magic, 4); output.write((const char*)&version, 4); output.write((const char*)&length, 4);
        
        uint32_t json_chunk_length = json_str.size(), json_chunk_type = 0x4E4F534A;
        output.write((const char*)&json_chunk_length, 4); output.write((const char*)&json_chunk_type, 4); output.write(json_str.data(), json_str.size());
        
        uint32_t bin_chunk_length = bin_data.size(), bin_chunk_type = 0x004E4942;
        output.write((const char*)&bin_chunk_length, 4); output.write((const char*)&bin_chunk_type, 4); output.write((const char*)bin_data.data(), bin_data.size());
    } else {
        j["buffers"] = {{ {"byteLength", bin_data.size()}, {"uri", "data:application/octet-stream;base64," + base64_encode(bin_data.data(), bin_data.size())} }};
        output << j.dump(2);
    }
}
