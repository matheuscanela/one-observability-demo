"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Applications = void 0;
const iam = require("aws-cdk-lib/aws-iam");
const ssm = require("aws-cdk-lib/aws-ssm");
const eks = require("aws-cdk-lib/aws-eks");
const resourcegroups = require("aws-cdk-lib/aws-resourcegroups");
const aws_ecr_assets_1 = require("aws-cdk-lib/aws-ecr-assets");
const yaml = require("js-yaml");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const fs_1 = require("fs");
const container_image_builder_1 = require("./common/container-image-builder");
const pet_adoptions_history_application_1 = require("./applications/pet-adoptions-history-application");
class Applications extends aws_cdk_lib_1.Stack {
    constructor(scope, id, props) {
        var _a;
        super(scope, id, props);
        const stackName = id;
        const roleArn = ssm.StringParameter.fromStringParameterAttributes(this, 'getParamClusterAdmin', { parameterName: "/eks/petsite/EKSMasterRoleArn" }).stringValue;
        const targetGroupArn = ssm.StringParameter.fromStringParameterAttributes(this, 'getParamTargetGroupArn', { parameterName: "/eks/petsite/TargetGroupArn" }).stringValue;
        const oidcProviderUrl = ssm.StringParameter.fromStringParameterAttributes(this, 'getOIDCProviderUrl', { parameterName: "/eks/petsite/OIDCProviderUrl" }).stringValue;
        const oidcProviderArn = ssm.StringParameter.fromStringParameterAttributes(this, 'getOIDCProviderArn', { parameterName: "/eks/petsite/OIDCProviderArn" }).stringValue;
        const rdsSecretArn = ssm.StringParameter.fromStringParameterAttributes(this, 'getRdsSecretArn', { parameterName: "/petstore/rdssecretarn" }).stringValue;
        const petHistoryTargetGroupArn = ssm.StringParameter.fromStringParameterAttributes(this, 'getPetHistoryParamTargetGroupArn', { parameterName: "/eks/pethistory/TargetGroupArn" }).stringValue;
        const cluster = eks.Cluster.fromClusterAttributes(this, 'MyCluster', {
            clusterName: 'PetSite',
            kubectlRoleArn: roleArn,
        });
        // ClusterID is not available for creating the proper conditions https://github.com/aws/aws-cdk/issues/10347
        // Thsos might be an issue
        const clusterId = aws_cdk_lib_1.Fn.select(4, aws_cdk_lib_1.Fn.split('/', oidcProviderUrl)); // Remove https:// from the URL as workaround to get ClusterID
        const stack = aws_cdk_lib_1.Stack.of(this);
        const region = stack.region;
        const app_federatedPrincipal = new iam.FederatedPrincipal(oidcProviderArn, {
            StringEquals: new aws_cdk_lib_1.CfnJson(this, "App_FederatedPrincipalCondition", {
                value: {
                    [`oidc.eks.${region}.amazonaws.com/id/${clusterId}:aud`]: "sts.amazonaws.com"
                }
            })
        });
        const app_trustRelationship = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            principals: [app_federatedPrincipal],
            actions: ["sts:AssumeRoleWithWebIdentity"]
        });
        // FrontEnd SA (SSM, SQS, SNS)
        const petstoreserviceaccount = new iam.Role(this, 'PetSiteServiceAccount', {
            //                assumedBy: eksFederatedPrincipal,
            assumedBy: new iam.AccountRootPrincipal(),
            managedPolicies: [
                iam.ManagedPolicy.fromManagedPolicyArn(this, 'PetSiteServiceAccount-AmazonSSMFullAccess', 'arn:aws:iam::aws:policy/AmazonSSMFullAccess'),
                iam.ManagedPolicy.fromManagedPolicyArn(this, 'PetSiteServiceAccount-AmazonSQSFullAccess', 'arn:aws:iam::aws:policy/AmazonSQSFullAccess'),
                iam.ManagedPolicy.fromManagedPolicyArn(this, 'PetSiteServiceAccount-AmazonSNSFullAccess', 'arn:aws:iam::aws:policy/AmazonSNSFullAccess'),
                iam.ManagedPolicy.fromManagedPolicyArn(this, 'PetSiteServiceAccount-AWSXRayDaemonWriteAccess', 'arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess')
            ],
        });
        (_a = petstoreserviceaccount.assumeRolePolicy) === null || _a === void 0 ? void 0 : _a.addStatements(app_trustRelationship);
        const startStepFnExecutionPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'states:StartExecution'
            ],
            resources: ['*']
        });
        petstoreserviceaccount.addToPrincipalPolicy(startStepFnExecutionPolicy);
        const petsiteAsset = new aws_ecr_assets_1.DockerImageAsset(this, 'petsiteAsset', {
            directory: "./resources/microservices/petsite/petsite/"
        });
        var manifest = (0, fs_1.readFileSync)("./resources/k8s_petsite/deployment.yaml", "utf8");
        var deploymentYaml = yaml.loadAll(manifest);
        deploymentYaml[0].metadata.annotations["eks.amazonaws.com/role-arn"] = new aws_cdk_lib_1.CfnJson(this, "deployment_Role", { value: `${petstoreserviceaccount.roleArn}` });
        deploymentYaml[2].spec.template.spec.containers[0].image = new aws_cdk_lib_1.CfnJson(this, "deployment_Image", { value: `${petsiteAsset.imageUri}` });
        deploymentYaml[3].spec.targetGroupARN = new aws_cdk_lib_1.CfnJson(this, "targetgroupArn", { value: `${targetGroupArn}` });
        const deploymentManifest = new eks.KubernetesManifest(this, "petsitedeployment", {
            cluster: cluster,
            manifest: deploymentYaml
        });
        // PetAdoptionsHistory application definitions-----------------------------------------------------------------------
        const petAdoptionsHistoryContainerImage = new container_image_builder_1.ContainerImageBuilder(this, 'pet-adoptions-history-container-image', {
            repositoryName: "pet-adoptions-history",
            dockerImageAssetDirectory: "./resources/microservices/petadoptionshistory-py",
        });
        new ssm.StringParameter(this, "putPetAdoptionHistoryRepositoryName", {
            stringValue: petAdoptionsHistoryContainerImage.repositoryUri,
            parameterName: '/petstore/pethistoryrepositoryuri'
        });
        const petAdoptionsHistoryApplication = new pet_adoptions_history_application_1.PetAdoptionsHistory(this, 'pet-adoptions-history-application', {
            cluster: cluster,
            app_trustRelationship: app_trustRelationship,
            kubernetesManifestPath: "./resources/microservices/petadoptionshistory-py/deployment.yaml",
            otelConfigMapPath: "./resources/microservices/petadoptionshistory-py/otel-collector-config.yaml",
            rdsSecretArn: rdsSecretArn,
            region: region,
            imageUri: petAdoptionsHistoryContainerImage.imageUri,
            targetGroupArn: petHistoryTargetGroupArn
        });
        this.createSsmParameters(new Map(Object.entries({
            '/eks/petsite/stackname': stackName
        })));
        this.createOuputs(new Map(Object.entries({
            'PetSiteECRImageURL': petsiteAsset.imageUri,
            'PetStoreServiceAccountArn': petstoreserviceaccount.roleArn,
        })));
        // Creating AWS Resource Group for all the resources of stack.
        const applicationsCfnGroup = new resourcegroups.CfnGroup(this, 'ApplicationsCfnGroup', {
            name: stackName,
            description: 'Contains all the resources deployed by Cloudformation Stack ' + stackName,
            resourceQuery: {
                type: 'CLOUDFORMATION_STACK_1_0',
            }
        });
    }
    createSsmParameters(params) {
        params.forEach((value, key) => {
            //const id = key.replace('/', '_');
            new ssm.StringParameter(this, key, { parameterName: key, stringValue: value });
        });
    }
    createOuputs(params) {
        params.forEach((value, key) => {
            new aws_cdk_lib_1.CfnOutput(this, key, { value: value });
        });
    }
}
exports.Applications = Applications;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwbGljYXRpb25zLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYXBwbGljYXRpb25zLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLDJDQUEyQztBQUMzQywyQ0FBMkM7QUFDM0MsMkNBQTJDO0FBQzNDLGlFQUFpRTtBQUNqRSwrREFBOEQ7QUFDOUQsZ0NBQWdDO0FBQ2hDLDZDQUF3RTtBQUN4RSwyQkFBa0M7QUFFbEMsOEVBQW9HO0FBQ3BHLHdHQUFzRjtBQUV0RixNQUFhLFlBQWEsU0FBUSxtQkFBSztJQUNyQyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQWtCOztRQUMxRCxLQUFLLENBQUMsS0FBSyxFQUFDLEVBQUUsRUFBQyxLQUFLLENBQUMsQ0FBQztRQUV0QixNQUFNLFNBQVMsR0FBRyxFQUFFLENBQUM7UUFFckIsTUFBTSxPQUFPLEdBQUcsR0FBRyxDQUFDLGVBQWUsQ0FBQyw2QkFBNkIsQ0FBQyxJQUFJLEVBQUUsc0JBQXNCLEVBQUUsRUFBRSxhQUFhLEVBQUUsK0JBQStCLEVBQUMsQ0FBQyxDQUFDLFdBQVcsQ0FBQztRQUMvSixNQUFNLGNBQWMsR0FBRyxHQUFHLENBQUMsZUFBZSxDQUFDLDZCQUE2QixDQUFDLElBQUksRUFBRSx3QkFBd0IsRUFBRSxFQUFFLGFBQWEsRUFBRSw2QkFBNkIsRUFBQyxDQUFDLENBQUMsV0FBVyxDQUFDO1FBQ3RLLE1BQU0sZUFBZSxHQUFHLEdBQUcsQ0FBQyxlQUFlLENBQUMsNkJBQTZCLENBQUMsSUFBSSxFQUFFLG9CQUFvQixFQUFFLEVBQUUsYUFBYSxFQUFFLDhCQUE4QixFQUFDLENBQUMsQ0FBQyxXQUFXLENBQUM7UUFDcEssTUFBTSxlQUFlLEdBQUcsR0FBRyxDQUFDLGVBQWUsQ0FBQyw2QkFBNkIsQ0FBQyxJQUFJLEVBQUUsb0JBQW9CLEVBQUUsRUFBRSxhQUFhLEVBQUUsOEJBQThCLEVBQUMsQ0FBQyxDQUFDLFdBQVcsQ0FBQztRQUNwSyxNQUFNLFlBQVksR0FBRyxHQUFH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Q0FBQyxDQUFDLEtBQUssRUFBRSxHQUFHLEVBQUUsRUFBRTtZQUMxQixtQ0FBbUM7WUFDbkMsSUFBSSxHQUFHLENBQUMsZUFBZSxDQUFDLElBQUksRUFBRSxHQUFHLEVBQUUsRUFBRSxhQUFhLEVBQUUsR0FBRyxFQUFFLFdBQVcsRUFBRSxLQUFLLEVBQUUsQ0FBQyxDQUFDO1FBQ25GLENBQUMsQ0FBQyxDQUFDO0lBQ0gsQ0FBQztJQUVPLFlBQVksQ0FBQyxNQUEyQjtRQUNoRCxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsS0FBSyxFQUFFLEdBQUcsRUFBRSxFQUFFO1lBQzFCLElBQUksdUJBQVMsQ0FBQyxJQUFJLEVBQUUsR0FBRyxFQUFFLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxDQUFDLENBQUE7UUFDOUMsQ0FBQyxDQUFDLENBQUM7SUFDSCxDQUFDO0NBQ0o7QUFwSUQsb0NBb0lDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0ICogYXMgc3NtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zc20nO1xuaW1wb3J0ICogYXMgZWtzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1la3MnO1xuaW1wb3J0ICogYXMgcmVzb3VyY2Vncm91cHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXJlc291cmNlZ3JvdXBzJztcbmltcG9ydCB7IERvY2tlckltYWdlQXNzZXQgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWNyLWFzc2V0cyc7XG5pbXBvcnQgKiBhcyB5YW1sIGZyb20gJ2pzLXlhbWwnO1xuaW1wb3J0IHsgU3RhY2ssIFN0YWNrUHJvcHMsIENmbkpzb24sIEZuLCBDZm5PdXRwdXQgfSBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyByZWFkRmlsZVN5bmMgfSBmcm9tICdmcyc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJ1xuaW1wb3J0IHsgQ29udGFpbmVySW1hZ2VCdWlsZGVyUHJvcHMsIENvbnRhaW5lckltYWdlQnVpbGRlciB9IGZyb20gJy4vY29tbW9uL2NvbnRhaW5lci1pbWFnZS1idWlsZGVyJ1xuaW1wb3J0IHsgUGV0QWRvcHRpb25zSGlzdG9yeSB9IGZyb20gJy4vYXBwbGljYXRpb25zL3BldC1hZG9wdGlvbnMtaGlzdG9yeS1hcHBsaWNhdGlvbidcblxuZXhwb3J0IGNsYXNzIEFwcGxpY2F0aW9ucyBleHRlbmRzIFN0YWNrIHtcbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBTdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsaWQscHJvcHMpO1xuXG4gICAgY29uc3Qgc3RhY2tOYW1lID0gaWQ7XG5cbiAgICBjb25zdCByb2xlQXJuID0gc3NtLlN0cmluZ1BhcmFtZXRlci5mcm9tU3RyaW5nUGFyYW1ldGVyQXR0cmlidXRlcyh0aGlzLCAnZ2V0UGFyYW1DbHVzdGVyQWRtaW4nLCB7IHBhcmFtZXRlck5hbWU6IFwiL2Vrcy9wZXRzaXRlL0VLU01hc3RlclJvbGVBcm5cIn0pLnN0cmluZ1ZhbHVlO1xuICAgIGNvbnN0IHRhcmdldEdyb3VwQXJuID0gc3NtLlN0cmluZ1BhcmFtZXRlci5mcm9tU3RyaW5nUGFyYW1ldGVyQXR0cmlidXRlcyh0aGlzLCAnZ2V0UGFyYW1UYXJnZXRHcm91cEFybicsIHsgcGFyYW1ldGVyTmFtZTogXCIvZWtzL3BldHNpdGUvVGFyZ2V0R3JvdXBBcm5cIn0pLnN0cmluZ1ZhbHVlO1xuICAgIGNvbnN0IG9pZGNQcm92aWRlclVybCA9IHNzbS5TdHJpbmdQYXJhbWV0ZXIuZnJvbVN0cmluZ1BhcmFtZXRlckF0dHJpYnV0ZXModGhpcywgJ2dldE9JRENQcm92aWRlclVybCcsIHsgcGFyYW1ldGVyTmFtZTogXCIvZWtzL3BldHNpdGUvT0lEQ1Byb3ZpZGVyVXJsXCJ9KS5zdHJpbmdWYWx1ZTtcbiAgICBjb25zdCBvaWRjUHJvdmlkZXJBcm4gPSBzc20uU3RyaW5nUGFyYW1ldGVyLmZyb21TdHJpbmdQYXJhbWV0ZXJBdHRyaWJ1dGVzKHRoaXMsICdnZXRPSURDUHJvdmlkZXJBcm4nLCB7IHBhcmFtZXRlck5hbWU6IFwiL2Vrcy9wZXRzaXRlL09JRENQcm92aWRlckFyblwifSkuc3RyaW5nVmFsdWU7XG4gICAgY29uc3QgcmRzU2VjcmV0QXJuID0gc3NtLlN0cmluZ1BhcmFtZXRlci5mcm9tU3RyaW5nUGFyYW1ldGVyQXR0cmlidXRlcyh0aGlzLCAnZ2V0UmRzU2VjcmV0QXJuJywgeyBwYXJhbWV0ZXJOYW1lOiBcIi9wZXRzdG9yZS9yZHNzZWNyZXRhcm5cIn0pLnN0cmluZ1ZhbHVlO1xuICAgIGNvbnN0IHBldEhpc3RvcnlUYXJnZXRHcm91cEFybiA9IHNzbS5TdHJpbmdQYXJhbWV0ZXIuZnJvbVN0cmluZ1BhcmFtZXRlckF0dHJpYnV0ZXModGhpcywgJ2dldFBldEhpc3RvcnlQYXJhbVRhcmdldEdyb3VwQXJuJywgeyBwYXJhbWV0ZXJOYW1lOiBcIi9la3MvcGV0aGlzdG9yeS9UYXJnZXRHcm91cEFyblwifSkuc3RyaW5nVmFsdWU7XG5cbiAgICBjb25zdCBjbHVzdGVyID0gZWtzLkNsdXN0ZXIuZnJvbUNsdXN0ZXJBdHRyaWJ1dGVzKHRoaXMsICdNeUNsdXN0ZXInLCB7XG4gICAgICBjbHVzdGVyTmFtZTogJ1BldFNpdGUnLFxuICAgICAga3ViZWN0bFJvbGVBcm46IHJvbGVBcm4sXG4gICAgfSk7XG4gICAgLy8gQ2x1c3RlcklEIGlzIG5vdCBhdmFpbGFibGUgZm9yIGNyZWF0aW5nIHRoZSBwcm9wZXIgY29uZGl0aW9ucyBodHRwczovL2dpdGh1Yi5jb20vYXdzL2F3cy1jZGsvaXNzdWVzLzEwMzQ3XG4gICAgLy8gVGhzb3MgbWlnaHQgYmUgYW4gaXNzdWVcbiAgICBjb25zdCBjbHVzdGVySWQgPSBGbi5zZWxlY3QoNCwgRm4uc3BsaXQoJy8nLCBvaWRjUHJvdmlkZXJVcmwpKSAvLyBSZW1vdmUgaHR0cHM6Ly8gZnJvbSB0aGUgVVJMIGFzIHdvcmthcm91bmQgdG8gZ2V0IENsdXN0ZXJJRFxuXG4gICAgY29uc3Qgc3RhY2sgPSBTdGFjay5vZih0aGlzKTtcbiAgICBjb25zdCByZWdpb24gPSBzdGFjay5yZWdpb247XG5cbiAgICBjb25zdCBhcHBfZmVkZXJhdGVkUHJpbmNpcGFsID0gbmV3IGlhbS5GZWRlcmF0ZWRQcmluY2lwYWwoXG4gICAgICAgIG9pZGNQcm92aWRlckFybixcbiAgICAgICAge1xuICAgICAgICAgICAgU3RyaW5nRXF1YWxzOiBuZXcgQ2ZuSnNvbih0aGlzLCBcIkFwcF9GZWRlcmF0ZWRQcmluY2lwYWxDb25kaXRpb25cIiwge1xuICAgICAgICAgICAgICAgIHZhbHVlOiB7XG4gICAgICAgICAgICAgICAgICAgIFtgb2lkYy5la3MuJHtyZWdpb259LmFtYXpvbmF3cy5jb20vaWQvJHtjbHVzdGVySWR9OmF1ZGAgXTogXCJzdHMuYW1hem9uYXdzLmNvbVwiXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgICk7XG4gICAgY29uc3QgYXBwX3RydXN0UmVsYXRpb25zaGlwID0gbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIHByaW5jaXBhbHM6IFsgYXBwX2ZlZGVyYXRlZFByaW5jaXBhbCBdLFxuICAgICAgICBhY3Rpb25zOiBbXCJzdHM6QXNzdW1lUm9sZVdpdGhXZWJJZGVudGl0eVwiXVxuICAgIH0pXG5cblxuICAgIC8vIEZyb250RW5kIFNBIChTU00sIFNRUywgU05TKVxuICAgIGNvbnN0IHBldHN0b3Jlc2VydmljZWFjY291bnQgPSBuZXcgaWFtLlJvbGUodGhpcywgJ1BldFNpdGVTZXJ2aWNlQWNjb3VudCcsIHtcbi8vICAgICAgICAgICAgICAgIGFzc3VtZWRCeTogZWtzRmVkZXJhdGVkUHJpbmNpcGFsLFxuICAgICAgICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLkFjY291bnRSb290UHJpbmNpcGFsKCksXG4gICAgICAgIG1hbmFnZWRQb2xpY2llczogW1xuICAgICAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbU1hbmFnZWRQb2xpY3lBcm4odGhpcywgJ1BldFNpdGVTZXJ2aWNlQWNjb3VudC1BbWF6b25TU01GdWxsQWNjZXNzJywgJ2Fybjphd3M6aWFtOjphd3M6cG9saWN5L0FtYXpvblNTTUZ1bGxBY2Nlc3MnKSxcbiAgICAgICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21NYW5hZ2VkUG9saWN5QXJuKHRoaXMsICdQZXRTaXRlU2VydmljZUFjY291bnQtQW1hem9uU1FTRnVsbEFjY2VzcycsICdhcm46YXdzOmlhbTo6YXdzOnBvbGljeS9BbWF6b25TUVNGdWxsQWNjZXNzJyksXG4gICAgICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tTWFuYWdlZFBvbGljeUFybih0aGlzLCAnUGV0U2l0ZVNlcnZpY2VBY2NvdW50LUFtYXpvblNOU0Z1bGxBY2Nlc3MnLCAnYXJuOmF3czppYW06OmF3czpwb2xpY3kvQW1hem9uU05TRnVsbEFjY2VzcycpLFxuICAgICAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbU1hbmFnZWRQb2xpY3lBcm4odGhpcywgJ1BldFNpdGVTZXJ2aWNlQWNjb3VudC1BV1NYUmF5RGFlbW9uV3JpdGVBY2Nlc3MnLCAnYXJuOmF3czppYW06OmF3czpwb2xpY3kvQVdTWFJheURhZW1vbldyaXRlQWNjZXNzJylcbiAgICAgICAgXSxcbiAgICB9KTtcbiAgICBwZXRzdG9yZXNlcnZpY2VhY2NvdW50LmFzc3VtZVJvbGVQb2xpY3k/LmFkZFN0YXRlbWVudHMoYXBwX3RydXN0UmVsYXRpb25zaGlwKTtcblxuICAgIGNvbnN0IHN0YXJ0U3RlcEZuRXhlY3V0aW9uUG9saWN5ID0gbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAgICdzdGF0ZXM6U3RhcnRFeGVjdXRpb24nXG4gICAgICAgIF0sXG4gICAgICAgIHJlc291cmNlczogWycqJ11cbiAgICAgICAgfSk7XG5cbiAgICBwZXRzdG9yZXNlcnZpY2VhY2NvdW50LmFkZFRvUHJpbmNpcGFsUG9saWN5KHN0YXJ0U3RlcEZuRXhlY3V0aW9uUG9saWN5KTtcblxuICAgIGNvbnN0IHBldHNpdGVBc3NldCA9IG5ldyBEb2NrZXJJbWFnZUFzc2V0KHRoaXMsICdwZXRzaXRlQXNzZXQnLCB7XG4gICAgICAgIGRpcmVjdG9yeTogXCIuL3Jlc291cmNlcy9taWNyb3NlcnZpY2VzL3BldHNpdGUvcGV0c2l0ZS9cIlxuICAgIH0pO1xuXG5cbiAgICB2YXIgbWFuaWZlc3QgPSByZWFkRmlsZVN5bmMoXCIuL3Jlc291cmNlcy9rOHNfcGV0c2l0ZS9kZXBsb3ltZW50LnlhbWxcIixcInV0ZjhcIik7XG4gICAgdmFyIGRlcGxveW1lbnRZYW1sID0geWFtbC5sb2FkQWxsKG1hbmlmZXN0KSBhcyBSZWNvcmQ8c3RyaW5nLGFueT5bXTtcblxuICAgIGRlcGxveW1lbnRZYW1sWzBdLm1ldGFkYXRhLmFubm90YXRpb25zW1wiZWtzLmFtYXpvbmF3cy5jb20vcm9sZS1hcm5cIl0gPSBuZXcgQ2ZuSnNvbih0aGlzLCBcImRlcGxveW1lbnRfUm9sZVwiLCB7IHZhbHVlIDogYCR7cGV0c3RvcmVzZXJ2aWNlYWNjb3VudC5yb2xlQXJufWAgfSk7XG4gICAgZGVwbG95bWVudFlhbWxbMl0uc3BlYy50ZW1wbGF0ZS5zcGVjLmNvbnRhaW5lcnNbMF0uaW1hZ2UgPSBuZXcgQ2ZuSnNvbih0aGlzLCBcImRlcGxveW1lbnRfSW1hZ2VcIiwgeyB2YWx1ZSA6IGAke3BldHNpdGVBc3NldC5pbWFnZVVyaX1gIH0pO1xuICAgIGRlcGxveW1lbnRZYW1sWzNdLnNwZWMudGFyZ2V0R3JvdXBBUk4gPSBuZXcgQ2ZuSnNvbih0aGlzLFwidGFyZ2V0Z3JvdXBBcm5cIiwgeyB2YWx1ZTogYCR7dGFyZ2V0R3JvdXBBcm59YH0pXG5cbiAgICBjb25zdCBkZXBsb3ltZW50TWFuaWZlc3QgPSBuZXcgZWtzLkt1YmVybmV0ZXNNYW5pZmVzdCh0aGlzLFwicGV0c2l0ZWRlcGxveW1lbnRcIix7XG4gICAgICAgIGNsdXN0ZXI6IGNsdXN0ZXIsXG4gICAgICAgIG1hbmlmZXN0OiBkZXBsb3ltZW50WWFtbFxuICAgIH0pO1xuXG4gICAgLy8gUGV0QWRvcHRpb25zSGlzdG9yeSBhcHBsaWNhdGlvbiBkZWZpbml0aW9ucy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgY29uc3QgcGV0QWRvcHRpb25zSGlzdG9yeUNvbnRhaW5lckltYWdlID0gbmV3IENvbnRhaW5lckltYWdlQnVpbGRlcih0aGlzLCAncGV0LWFkb3B0aW9ucy1oaXN0b3J5LWNvbnRhaW5lci1pbWFnZScsIHtcbiAgICAgICByZXBvc2l0b3J5TmFtZTogXCJwZXQtYWRvcHRpb25zLWhpc3RvcnlcIixcbiAgICAgICBkb2NrZXJJbWFnZUFzc2V0RGlyZWN0b3J5OiBcIi4vcmVzb3VyY2VzL21pY3Jvc2VydmljZXMvcGV0YWRvcHRpb25zaGlzdG9yeS1weVwiLFxuICAgIH0pO1xuICAgIG5ldyBzc20uU3RyaW5nUGFyYW1ldGVyKHRoaXMsXCJwdXRQZXRBZG9wdGlvbkhpc3RvcnlSZXBvc2l0b3J5TmFtZVwiLHtcbiAgICAgICAgc3RyaW5nVmFsdWU6IHBldEFkb3B0aW9uc0hpc3RvcnlDb250YWluZXJJbWFnZS5yZXBvc2l0b3J5VXJpLFxuICAgICAgICBwYXJhbWV0ZXJOYW1lOiAnL3BldHN0b3JlL3BldGhpc3RvcnlyZXBvc2l0b3J5dXJpJ1xuICAgIH0pO1xuXG4gICAgY29uc3QgcGV0QWRvcHRpb25zSGlzdG9yeUFwcGxpY2F0aW9uID0gbmV3IFBldEFkb3B0aW9uc0hpc3RvcnkodGhpcywgJ3BldC1hZG9wdGlvbnMtaGlzdG9yeS1hcHBsaWNhdGlvbicsIHtcbiAgICAgICAgY2x1c3RlcjogY2x1c3RlcixcbiAgICAgICAgYXBwX3RydXN0UmVsYXRpb25zaGlwOiBhcHBfdHJ1c3RSZWxhdGlvbnNoaXAsXG4gICAgICAgIGt1YmVybmV0ZXNNYW5pZmVzdFBhdGg6IFwiLi9yZXNvdXJjZXMvbWljcm9zZXJ2aWNlcy9wZXRhZG9wdGlvbnNoaXN0b3J5LXB5L2RlcGxveW1lbnQueWFtbFwiLFxuICAgICAgICBvdGVsQ29uZmlnTWFwUGF0aDogXCIuL3Jlc291cmNlcy9taWNyb3NlcnZpY2VzL3BldGFkb3B0aW9uc2hpc3RvcnktcHkvb3RlbC1jb2xsZWN0b3ItY29uZmlnLnlhbWxcIixcbiAgICAgICAgcmRzU2VjcmV0QXJuOiByZHNTZWNyZXRBcm4sXG4gICAgICAgIHJlZ2lvbjogcmVnaW9uLFxuICAgICAgICBpbWFnZVVyaTogcGV0QWRvcHRpb25zSGlzdG9yeUNvbnRhaW5lckltYWdlLmltYWdlVXJpLFxuICAgICAgICB0YXJnZXRHcm91cEFybjogcGV0SGlzdG9yeVRhcmdldEdyb3VwQXJuXG4gICAgfSk7XG5cbiAgICB0aGlzLmNyZWF0ZVNzbVBhcmFtZXRlcnMobmV3IE1hcChPYmplY3QuZW50cmllcyh7XG4gICAgICAgICcvZWtzL3BldHNpdGUvc3RhY2tuYW1lJzogc3RhY2tOYW1lXG4gICAgfSkpKTtcblxuICAgIHRoaXMuY3JlYXRlT3VwdXRzKG5ldyBNYXAoT2JqZWN0LmVudHJpZXMoe1xuICAgICAgICAnUGV0U2l0ZUVDUkltYWdlVVJMJzogcGV0c2l0ZUFzc2V0LmltYWdlVXJpLFxuICAgICAgICAnUGV0U3RvcmVTZXJ2aWNlQWNjb3VudEFybic6IHBldHN0b3Jlc2VydmljZWFjY291bnQucm9sZUFybixcbiAgICB9KSkpO1xuICAgIC8vIENyZWF0aW5nIEFXUyBSZXNvdXJjZSBHcm91cCBmb3IgYWxsIHRoZSByZXNvdXJjZXMgb2Ygc3RhY2suXG4gICAgY29uc3QgYXBwbGljYXRpb25zQ2ZuR3JvdXAgPSBuZXcgcmVzb3VyY2Vncm91cHMuQ2ZuR3JvdXAodGhpcywgJ0FwcGxpY2F0aW9uc0Nmbkdyb3VwJywge1xuICAgICAgICBuYW1lOiBzdGFja05hbWUsXG4gICAgICAgIGRlc2NyaXB0aW9uOiAnQ29udGFpbnMgYWxsIHRoZSByZXNvdXJjZXMgZGVwbG95ZWQgYnkgQ2xvdWRmb3JtYXRpb24gU3RhY2sgJyArIHN0YWNrTmFtZSxcbiAgICAgICAgcmVzb3VyY2VRdWVyeToge1xuICAgICAgICAgIHR5cGU6ICdDTE9VREZPUk1BVElPTl9TVEFDS18xXzAnLFxuICAgICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGNyZWF0ZVNzbVBhcmFtZXRlcnMocGFyYW1zOiBNYXA8c3RyaW5nLCBzdHJpbmc+KSB7XG4gICAgcGFyYW1zLmZvckVhY2goKHZhbHVlLCBrZXkpID0+IHtcbiAgICAgICAgLy9jb25zdCBpZCA9IGtleS5yZXBsYWNlKCcvJywgJ18nKTtcbiAgICAgICAgbmV3IHNzbS5TdHJpbmdQYXJhbWV0ZXIodGhpcywga2V5LCB7IHBhcmFtZXRlck5hbWU6IGtleSwgc3RyaW5nVmFsdWU6IHZhbHVlIH0pO1xuICAgIH0pO1xuICAgIH1cblxuICAgIHByaXZhdGUgY3JlYXRlT3VwdXRzKHBhcmFtczogTWFwPHN0cmluZywgc3RyaW5nPikge1xuICAgIHBhcmFtcy5mb3JFYWNoKCh2YWx1ZSwga2V5KSA9PiB7XG4gICAgICAgIG5ldyBDZm5PdXRwdXQodGhpcywga2V5LCB7IHZhbHVlOiB2YWx1ZSB9KVxuICAgIH0pO1xuICAgIH1cbn1cbiJdfQ==