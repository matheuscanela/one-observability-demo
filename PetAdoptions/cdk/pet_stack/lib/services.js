"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Services = void 0;
const iam = require("aws-cdk-lib/aws-iam");
const ec2 = require("aws-cdk-lib/aws-ec2");
const ecs = require("aws-cdk-lib/aws-ecs");
const sns = require("aws-cdk-lib/aws-sns");
const sqs = require("aws-cdk-lib/aws-sqs");
const subs = require("aws-cdk-lib/aws-sns-subscriptions");
const ddb = require("aws-cdk-lib/aws-dynamodb");
const s3 = require("aws-cdk-lib/aws-s3");
const s3seeder = require("aws-cdk-lib/aws-s3-deployment");
const rds = require("aws-cdk-lib/aws-rds");
const ssm = require("aws-cdk-lib/aws-ssm");
const kms = require("aws-cdk-lib/aws-kms");
const eks = require("aws-cdk-lib/aws-eks");
const yaml = require("js-yaml");
const path = require("path");
const lambda = require("aws-cdk-lib/aws-lambda");
const elbv2 = require("aws-cdk-lib/aws-elasticloadbalancingv2");
const cloudwatch = require("aws-cdk-lib/aws-cloudwatch");
const applicationinsights = require("aws-cdk-lib/aws-applicationinsights");
const resourcegroups = require("aws-cdk-lib/aws-resourcegroups");
const pay_for_adoption_service_1 = require("./services/pay-for-adoption-service");
const list_adoptions_service_1 = require("./services/list-adoptions-service");
const search_service_1 = require("./services/search-service");
const traffic_generator_service_1 = require("./services/traffic-generator-service");
const status_updater_service_1 = require("./services/status-updater-service");
const stepfn_1 = require("./services/stepfn");
const aws_eks_1 = require("aws-cdk-lib/aws-eks");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const fs_1 = require("fs");
require("ts-replace-all");
const aws_cloudwatch_1 = require("aws-cdk-lib/aws-cloudwatch");
const lambda_layer_kubectl_1 = require("aws-cdk-lib/lambda-layer-kubectl");
const cloud9_1 = require("./modules/core/cloud9");
class Services extends aws_cdk_lib_1.Stack {
    constructor(scope, id, props) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
        super(scope, id, props);
        var isEventEngine = 'false';
        if (this.node.tryGetContext('is_event_engine') != undefined) {
            isEventEngine = this.node.tryGetContext('is_event_engine');
        }
        const stackName = id;
        // Create SQS resource to send Pet adoption messages to
        const sqsQueue = new sqs.Queue(this, 'sqs_petadoption', {
            visibilityTimeout: aws_cdk_lib_1.Duration.seconds(300)
        });
        // Create SNS and an email topic to send notifications to
        const topic_petadoption = new sns.Topic(this, 'topic_petadoption');
        var topic_email = this.node.tryGetContext('snstopic_email');
        if (topic_email == undefined) {
            topic_email = "someone@example.com";
        }
        topic_petadoption.addSubscription(new subs.EmailSubscription(topic_email));
        // Creates an S3 bucket to store pet images
        const s3_observabilitypetadoptions = new s3.Bucket(this, 's3bucket_petadoption', {
            publicReadAccess: false,
            autoDeleteObjects: true,
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
        });
        // Creates the DynamoDB table for Petadoption data
        const dynamodb_petadoption = new ddb.Table(this, 'ddb_petadoption', {
            partitionKey: {
                name: 'pettype',
                type: ddb.AttributeType.STRING
            },
            sortKey: {
                name: 'petid',
                type: ddb.AttributeType.STRING
            },
            readCapacity: 2000,
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY
        });
        dynamodb_petadoption.metric('WriteThrottleEvents', { statistic: "avg" }).createAlarm(this, 'WriteThrottleEvents-BasicAlarm', {
            threshold: 0,
            treatMissingData: aws_cloudwatch_1.TreatMissingData.NOT_BREACHING,
            comparisonOperator: aws_cloudwatch_1.ComparisonOperator.GREATER_THAN_THRESHOLD,
            evaluationPeriods: 1,
            alarmName: `${dynamodb_petadoption.tableName}-WriteThrottleEvents-BasicAlarm`,
        });
        dynamodb_petadoption.metric('ReadThrottleEvents', { statistic: "avg" }).createAlarm(this, 'ReadThrottleEvents-BasicAlarm', {
            threshold: 0,
            treatMissingData: aws_cloudwatch_1.TreatMissingData.NOT_BREACHING,
            comparisonOperator: aws_cloudwatch_1.ComparisonOperator.GREATER_THAN_THRESHOLD,
            evaluationPeriods: 1,
            alarmName: `${dynamodb_petadoption.tableName}-ReadThrottleEvents-BasicAlarm`,
        });
        // Seeds the S3 bucket with pet images
        new s3seeder.BucketDeployment(this, "s3seeder_petadoption", {
            destinationBucket: s3_observabilitypetadoptions,
            sources: [s3seeder.Source.asset('./resources/kitten.zip'), s3seeder.Source.asset('./resources/puppies.zip'), s3seeder.Source.asset('./resources/bunnies.zip')]
        });
        var cidrRange = this.node.tryGetContext('vpc_cidr');
        if (cidrRange == undefined) {
            cidrRange = "11.0.0.0/16";
        }
        // The VPC where all the microservices will be deployed into
        const theVPC = new ec2.Vpc(this, 'Microservices', {
            ipAddresses: ec2.IpAddresses.cidr(cidrRange),
            // cidr: cidrRange,
            natGateways: 1,
            maxAzs: 2
        });
        // Create RDS Aurora PG cluster
        const rdssecuritygroup = new ec2.SecurityGroup(this, 'petadoptionsrdsSG', {
            vpc: theVPC
        });
        rdssecuritygroup.addIngressRule(ec2.Peer.ipv4(theVPC.vpcCidrBlock), ec2.Port.tcp(5432), 'Allow Aurora PG access from within the VPC CIDR range');
        var rdsUsername = this.node.tryGetContext('rdsusername');
        if (rdsUsername == undefined) {
            rdsUsername = "petadmin";
        }
        const auroraCluster = new rds.ServerlessCluster(this, 'Database', {
            engine: rds.DatabaseClusterEngine.auroraPostgres({ version: rds.AuroraPostgresEngineVersion.VER_13_9 }),
            parameterGroup: rds.ParameterGroup.fromParameterGroupName(this, 'ParameterGroup', 'default.aurora-postgresql13'),
            vpc: theVPC,
            securityGroups: [rdssecuritygroup],
            defaultDatabaseName: 'adoptions',
            scaling: {
                autoPause: aws_cdk_lib_1.Duration.minutes(60),
                minCapacity: rds.AuroraCapacityUnit.ACU_2,
                maxCapacity: rds.AuroraCapacityUnit.ACU_8,
            }
        });
        const readSSMParamsPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'ssm:GetParametersByPath',
                'ssm:GetParameters',
                'ssm:GetParameter',
                'ec2:DescribeVpcs'
            ],
            resources: ['*']
        });
        const ddbSeedPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'dynamodb:BatchWriteItem',
                'dynamodb:ListTables',
                "dynamodb:Scan",
                "dynamodb:Query"
            ],
            resources: ['*']
        });
        const repositoryURI = "public.ecr.aws/one-observability-workshop";
        const stack = aws_cdk_lib_1.Stack.of(this);
        const region = stack.region;
        const ecsServicesSecurityGroup = new ec2.SecurityGroup(this, 'ECSServicesSG', {
            vpc: theVPC
        });
        ecsServicesSecurityGroup.addIngressRule(ec2.Peer.ipv4(theVPC.vpcCidrBlock), ec2.Port.tcp(80));
        const ecsPayForAdoptionCluster = new ecs.Cluster(this, "PayForAdoption", {
            vpc: theVPC,
            containerInsights: false
        });
        // PayForAdoption service definitions-----------------------------------------------------------------------
        const payForAdoptionService = new pay_for_adoption_service_1.PayForAdoptionService(this, 'pay-for-adoption-service', {
            cluster: ecsPayForAdoptionCluster,
            logGroupName: "/ecs/PayForAdoption",
            cpu: 1024,
            memoryLimitMiB: 2048,
            healthCheck: '/health/status',
            // build locally
            //repositoryURI: repositoryURI,
            database: auroraCluster,
            desiredTaskCount: 2,
            region: region,
            securityGroup: ecsServicesSecurityGroup
        });
        (_a = payForAdoptionService.taskDefinition.taskRole) === null || _a === void 0 ? void 0 : _a.addToPrincipalPolicy(readSSMParamsPolicy);
        (_b = payForAdoptionService.taskDefinition.taskRole) === null || _b === void 0 ? void 0 : _b.addToPrincipalPolicy(ddbSeedPolicy);
        const ecsPetListAdoptionCluster = new ecs.Cluster(this, "PetListAdoptions", {
            vpc: theVPC,
            containerInsights: false
        });
        // PetListAdoptions service definitions-----------------------------------------------------------------------
        const listAdoptionsService = new list_adoptions_service_1.ListAdoptionsService(this, 'list-adoptions-service', {
            cluster: ecsPetListAdoptionCluster,
            logGroupName: "/ecs/PetListAdoptions",
            cpu: 1024,
            memoryLimitMiB: 2048,
            healthCheck: '/health/status',
            instrumentation: 'otel',
            // build locally
            //repositoryURI: repositoryURI,
            database: auroraCluster,
            desiredTaskCount: 2,
            region: region,
            securityGroup: ecsServicesSecurityGroup
        });
        (_c = listAdoptionsService.taskDefinition.taskRole) === null || _c === void 0 ? void 0 : _c.addToPrincipalPolicy(readSSMParamsPolicy);
        const ecsPetSearchCluster = new ecs.Cluster(this, "PetSearch", {
            vpc: theVPC,
            containerInsights: false
        });
        // PetSearch service definitions-----------------------------------------------------------------------
        const searchService = new search_service_1.SearchService(this, 'search-service', {
            cluster: ecsPetSearchCluster,
            logGroupName: "/ecs/PetSearch",
            cpu: 1024,
            memoryLimitMiB: 2048,
            //repositoryURI: repositoryURI,
            healthCheck: '/health/status',
            desiredTaskCount: 2,
            instrumentation: 'otel',
            region: region,
            securityGroup: ecsServicesSecurityGroup
        });
        (_d = searchService.taskDefinition.taskRole) === null || _d === void 0 ? void 0 : _d.addToPrincipalPolicy(readSSMParamsPolicy);
        // Traffic Generator task definition.
        const trafficGeneratorService = new traffic_generator_service_1.TrafficGeneratorService(this, 'traffic-generator-service', {
            cluster: ecsPetListAdoptionCluster,
            logGroupName: "/ecs/PetTrafficGenerator",
            cpu: 256,
            memoryLimitMiB: 512,
            instrumentation: 'none',
            //repositoryURI: repositoryURI,
            desiredTaskCount: 1,
            region: region,
            securityGroup: ecsServicesSecurityGroup
        });
        (_e = trafficGeneratorService.taskDefinition.taskRole) === null || _e === void 0 ? void 0 : _e.addToPrincipalPolicy(readSSMParamsPolicy);
        //PetStatusUpdater Lambda Function and APIGW--------------------------------------
        const statusUpdaterService = new status_updater_service_1.StatusUpdaterService(this, 'status-updater-service', {
            tableName: dynamodb_petadoption.tableName
        });
        const albSG = new ec2.SecurityGroup(this, 'ALBSecurityGroup', {
            vpc: theVPC,
            securityGroupName: 'ALBSecurityGroup',
            allowAllOutbound: true
        });
        albSG.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80));
        // PetSite - Create ALB and Target Groups
        const alb = new elbv2.ApplicationLoadBalancer(this, 'PetSiteLoadBalancer', {
            vpc: theVPC,
            internetFacing: true,
            securityGroup: albSG
        });
        trafficGeneratorService.node.addDependency(alb);
        const targetGroup = new elbv2.ApplicationTargetGroup(this, 'PetSiteTargetGroup', {
            port: 80,
            protocol: elbv2.ApplicationProtocol.HTTP,
            vpc: theVPC,
            targetType: elbv2.TargetType.IP
        });
        new ssm.StringParameter(this, "putParamTargetGroupArn", {
            stringValue: targetGroup.targetGroupArn,
            parameterName: '/eks/petsite/TargetGroupArn'
        });
        const listener = alb.addListener('Listener', {
            port: 80,
            open: true,
            defaultTargetGroups: [targetGroup],
        });
        // PetAdoptionHistory - attach service to path /petadoptionhistory on PetSite ALB
        const petadoptionshistory_targetGroup = new elbv2.ApplicationTargetGroup(this, 'PetAdoptionsHistoryTargetGroup', {
            port: 80,
            protocol: elbv2.ApplicationProtocol.HTTP,
            vpc: theVPC,
            targetType: elbv2.TargetType.IP,
            healthCheck: {
                path: '/health/status',
            }
        });
        listener.addTargetGroups('PetAdoptionsHistoryTargetGroups', {
            priority: 10,
            conditions: [
                elbv2.ListenerCondition.pathPatterns(['/petadoptionshistory/*']),
            ],
            targetGroups: [petadoptionshistory_targetGroup]
        });
        new ssm.StringParameter(this, "putPetHistoryParamTargetGroupArn", {
            stringValue: petadoptionshistory_targetGroup.targetGroupArn,
            parameterName: '/eks/pethistory/TargetGroupArn'
        });
        // PetSite - EKS Cluster
        const clusterAdmin = new iam.Role(this, 'AdminRole', {
            assumedBy: new iam.AccountRootPrincipal()
        });
        new ssm.StringParameter(this, "putParam", {
            stringValue: clusterAdmin.roleArn,
            parameterName: '/eks/petsite/EKSMasterRoleArn'
        });
        const secretsKey = new kms.Key(this, 'SecretsKey');
        const cluster = new eks.Cluster(this, 'petsite', {
            clusterName: 'PetSite',
            mastersRole: clusterAdmin,
            vpc: theVPC,
            defaultCapacity: 2,
            defaultCapacityInstance: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
            secretsEncryptionKey: secretsKey,
            version: aws_eks_1.KubernetesVersion.of('1.27'),
            kubectlLayer: new lambda_layer_kubectl_1.KubectlLayer(this, 'kubectl')
        });
        const clusterSG = ec2.SecurityGroup.fromSecurityGroupId(this, 'ClusterSG', cluster.clusterSecurityGroupId);
        clusterSG.addIngressRule(albSG, ec2.Port.allTraffic(), 'Allow traffic from the ALB');
        clusterSG.addIngressRule(ec2.Peer.ipv4(theVPC.vpcCidrBlock), ec2.Port.tcp(443), 'Allow local access to k8s api');
        // Add SSM Permissions to the node role
        (_f = cluster.defaultNodegroup) === null || _f === void 0 ? void 0 : _f.role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"));
        // Add CloudWatchAgent Permissions to the node role
        (_g = cluster.defaultNodegroup) === null || _g === void 0 ? void 0 : _g.role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("CloudWatchAgentServerPolicy"));
        // Add CloudWatch metrics permission
        (_h = cluster.defaultNodegroup) === null || _h === void 0 ? void 0 : _h.role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("CloudWatchFullAccess"));
        // From https://github.com/aws-samples/ssm-agent-daemonset-installer
        var ssmAgentSetup = yaml.loadAll((0, fs_1.readFileSync)("./resources/setup-ssm-agent.yaml", "utf8"));
        const ssmAgentSetupManifest = new eks.KubernetesManifest(this, "ssmAgentdeployment", {
            cluster: cluster,
            manifest: ssmAgentSetup
        });
        // ClusterID is not available for creating the proper conditions https://github.com/aws/aws-cdk/issues/10347
        const clusterId = aws_cdk_lib_1.Fn.select(4, aws_cdk_lib_1.Fn.split('/', cluster.clusterOpenIdConnectIssuerUrl)); // Remove https:// from the URL as workaround to get ClusterID
        const cw_federatedPrincipal = new iam.FederatedPrincipal(cluster.openIdConnectProvider.openIdConnectProviderArn, {
            StringEquals: new aws_cdk_lib_1.CfnJson(this, "CW_FederatedPrincipalCondition", {
                value: {
                    [`oidc.eks.${region}.amazonaws.com/id/${clusterId}:aud`]: "sts.amazonaws.com"
                }
            })
        });
        const cw_trustRelationship = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            principals: [cw_federatedPrincipal],
            actions: ["sts:AssumeRoleWithWebIdentity"]
        });
        // Create IAM roles for Service Accounts
        // Cloudwatch Agent SA
        const cwserviceaccount = new iam.Role(this, 'CWServiceAccount', {
            //                assumedBy: eksFederatedPrincipal,
            assumedBy: new iam.AccountRootPrincipal(),
            managedPolicies: [
                iam.ManagedPolicy.fromManagedPolicyArn(this, 'CWServiceAccount-CloudWatchAgentServerPolicy', 'arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy')
            ],
        });
        (_j = cwserviceaccount.assumeRolePolicy) === null || _j === void 0 ? void 0 : _j.addStatements(cw_trustRelationship);
        const xray_federatedPrincipal = new iam.FederatedPrincipal(cluster.openIdConnectProvider.openIdConnectProviderArn, {
            StringEquals: new aws_cdk_lib_1.CfnJson(this, "Xray_FederatedPrincipalCondition", {
                value: {
                    [`oidc.eks.${region}.amazonaws.com/id/${clusterId}:aud`]: "sts.amazonaws.com"
                }
            })
        });
        const xray_trustRelationship = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            principals: [xray_federatedPrincipal],
            actions: ["sts:AssumeRoleWithWebIdentity"]
        });
        // X-Ray Agent SA
        const xrayserviceaccount = new iam.Role(this, 'XRayServiceAccount', {
            //                assumedBy: eksFederatedPrincipal,
            assumedBy: new iam.AccountRootPrincipal(),
            managedPolicies: [
                iam.ManagedPolicy.fromManagedPolicyArn(this, 'XRayServiceAccount-AWSXRayDaemonWriteAccess', 'arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess')
            ],
        });
        (_k = xrayserviceaccount.assumeRolePolicy) === null || _k === void 0 ? void 0 : _k.addStatements(xray_trustRelationship);
        const loadbalancer_federatedPrincipal = new iam.FederatedPrincipal(cluster.openIdConnectProvider.openIdConnectProviderArn, {
            StringEquals: new aws_cdk_lib_1.CfnJson(this, "LB_FederatedPrincipalCondition", {
                value: {
                    [`oidc.eks.${region}.amazonaws.com/id/${clusterId}:aud`]: "sts.amazonaws.com"
                }
            })
        });
        const loadBalancer_trustRelationship = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            principals: [loadbalancer_federatedPrincipal],
            actions: ["sts:AssumeRoleWithWebIdentity"]
        });
        const loadBalancerPolicyDoc = iam.PolicyDocument.fromJson(JSON.parse((0, fs_1.readFileSync)("./resources/load_balancer/iam_policy.json", "utf8")));
        const loadBalancerPolicy = new iam.ManagedPolicy(this, 'LoadBalancerSAPolicy', { document: loadBalancerPolicyDoc });
        const loadBalancerserviceaccount = new iam.Role(this, 'LoadBalancerServiceAccount', {
            //                assumedBy: eksFederatedPrincipal,
            assumedBy: new iam.AccountRootPrincipal(),
            managedPolicies: [loadBalancerPolicy]
        });
        (_l = loadBalancerserviceaccount.assumeRolePolicy) === null || _l === void 0 ? void 0 : _l.addStatements(loadBalancer_trustRelationship);
        // Fix for EKS Dashboard access
        const dashboardRoleYaml = yaml.loadAll((0, fs_1.readFileSync)("./resources/dashboard.yaml", "utf8"));
        const dashboardRoleArn = this.node.tryGetContext('dashboard_role_arn');
        if ((dashboardRoleArn != undefined) && (dashboardRoleArn.length > 0)) {
            const role = iam.Role.fromRoleArn(this, "DashboardRoleArn", dashboardRoleArn, { mutable: false });
            cluster.awsAuth.addRoleMapping(role, { groups: ["dashboard-view"] });
        }
        if (isEventEngine === 'true') {
            var c9Env = new cloud9_1.Cloud9Environment(this, 'Cloud9Environment', {
                vpcId: theVPC.vpcId,
                subnetId: theVPC.publicSubnets[0].subnetId,
                cloud9OwnerArn: "assumed-role/WSParticipantRole/Participant",
                templateFile: __dirname + "/../../../../cloud9-cfn.yaml"
            });
            var c9role = c9Env.c9Role;
            // Dynamically check if AWSCloud9SSMAccessRole and AWSCloud9SSMInstanceProfile exists
            const c9SSMRole = new iam.Role(this, 'AWSCloud9SSMAccessRole', {
                path: '/service-role/',
                roleName: 'AWSCloud9SSMAccessRole',
                assumedBy: new iam.CompositePrincipal(new iam.ServicePrincipal("ec2.amazonaws.com"), new iam.ServicePrincipal("cloud9.amazonaws.com")),
                managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName("AWSCloud9SSMInstanceProfile"), iam.ManagedPolicy.fromAwsManagedPolicyName("AdministratorAccess")]
            });
            const teamRole = iam.Role.fromRoleArn(this, 'TeamRole', "arn:aws:iam::" + stack.account + ":role/WSParticipantRole");
            cluster.awsAuth.addRoleMapping(teamRole, { groups: ["dashboard-view"] });
            if (c9role != undefined) {
                cluster.awsAuth.addMastersRole(iam.Role.fromRoleArn(this, 'c9role', c9role.attrArn, { mutable: false }));
            }
        }
        const eksAdminArn = this.node.tryGetContext('admin_role');
        if ((eksAdminArn != undefined) && (eksAdminArn.length > 0)) {
            const role = iam.Role.fromRoleArn(this, "ekdAdminRoleArn", eksAdminArn, { mutable: false });
            cluster.awsAuth.addMastersRole(role);
        }
        const dahshboardManifest = new eks.KubernetesManifest(this, "k8sdashboardrbac", {
            cluster: cluster,
            manifest: dashboardRoleYaml
        });
        var xRayYaml = yaml.loadAll((0, fs_1.readFileSync)("./resources/k8s_petsite/xray-daemon-config.yaml", "utf8"));
        xRayYaml[0].metadata.annotations["eks.amazonaws.com/role-arn"] = new aws_cdk_lib_1.CfnJson(this, "xray_Role", { value: `${xrayserviceaccount.roleArn}` });
        const xrayManifest = new eks.KubernetesManifest(this, "xraydeployment", {
            cluster: cluster,
            manifest: xRayYaml
        });
        var loadBalancerServiceAccountYaml = yaml.loadAll((0, fs_1.readFileSync)("./resources/load_balancer/service_account.yaml", "utf8"));
        loadBalancerServiceAccountYaml[0].metadata.annotations["eks.amazonaws.com/role-arn"] = new aws_cdk_lib_1.CfnJson(this, "loadBalancer_Role", { value: `${loadBalancerserviceaccount.roleArn}` });
        const loadBalancerServiceAccount = new eks.KubernetesManifest(this, "loadBalancerServiceAccount", {
            cluster: cluster,
            manifest: loadBalancerServiceAccountYaml
        });
        const waitForLBServiceAccount = new eks.KubernetesObjectValue(this, 'LBServiceAccount', {
            cluster: cluster,
            objectName: "alb-ingress-controller",
            objectType: "serviceaccount",
            objectNamespace: "kube-system",
            jsonPath: "@"
        });
        const loadBalancerCRDYaml = yaml.loadAll((0, fs_1.readFileSync)("./resources/load_balancer/crds.yaml", "utf8"));
        const loadBalancerCRDManifest = new eks.KubernetesManifest(this, "loadBalancerCRD", {
            cluster: cluster,
            manifest: loadBalancerCRDYaml
        });
        const awsLoadBalancerManifest = new eks.HelmChart(this, "AWSLoadBalancerController", {
            cluster: cluster,
            chart: "aws-load-balancer-controller",
            repository: "https://aws.github.io/eks-charts",
            namespace: "kube-system",
            values: {
                clusterName: "PetSite",
                serviceAccount: {
                    create: false,
                    name: "alb-ingress-controller"
                },
                wait: true
            }
        });
        awsLoadBalancerManifest.node.addDependency(loadBalancerCRDManifest);
        awsLoadBalancerManifest.node.addDependency(loadBalancerServiceAccount);
        awsLoadBalancerManifest.node.addDependency(waitForLBServiceAccount);
        // NOTE: amazon-cloudwatch namespace is created here!!
        // var fluentbitYaml = yaml.loadAll(readFileSync("./resources/cwagent-fluent-bit-quickstart.yaml","utf8")) as Record<string,any>[];
        // fluentbitYaml[1].metadata.annotations["eks.amazonaws.com/role-arn"] = new CfnJson(this, "fluentbit_Role", { value : `${cwserviceaccount.roleArn}` });
        // fluentbitYaml[4].data["cwagentconfig.json"] = JSON.stringify({
        //     agent: {
        //         region: region  },
        //     logs: {
        //         metrics_collected: {
        //             kubernetes: {
        //                 cluster_name: "PetSite",
        //                 metrics_collection_interval: 60
        //             }
        //         },
        //         force_flush_interval: 5
        //         }
        //     });
        // fluentbitYaml[6].data["cluster.name"] = "PetSite";
        // fluentbitYaml[6].data["logs.region"] = region;
        // fluentbitYaml[7].metadata.annotations["eks.amazonaws.com/role-arn"] = new CfnJson(this, "cloudwatch_Role", { value : `${cwserviceaccount.roleArn}` });
        // // The `cluster-info` configmap is used by the current Python implementation for the `AwsEksResourceDetector`
        // fluentbitYaml[12].data["cluster.name"] = "PetSite";
        // fluentbitYaml[12].data["logs.region"] = region;
        // const fluentbitManifest = new eks.KubernetesManifest(this,"cloudwatcheployment",{
        //     cluster: cluster,
        //     manifest: fluentbitYaml
        // });
        // CloudWatch agent for prometheus metrics
        // var prometheusYaml = yaml.loadAll(readFileSync("./resources/prometheus-eks.yaml","utf8")) as Record<string,any>[];
        // prometheusYaml[1].metadata.annotations["eks.amazonaws.com/role-arn"] = new CfnJson(this, "prometheus_Role", { value : `${cwserviceaccount.roleArn}` });
        // const prometheusManifest = new eks.KubernetesManifest(this,"prometheusdeployment",{
        //     cluster: cluster,
        //     manifest: prometheusYaml
        // });
        // prometheusManifest.node.addDependency(fluentbitManifest); // Namespace creation dependency
        var dashboardBody = (0, fs_1.readFileSync)("./resources/cw_dashboard_fluent_bit.json", "utf-8");
        dashboardBody = dashboardBody.replaceAll("{{YOUR_CLUSTER_NAME}}", "PetSite");
        dashboardBody = dashboardBody.replaceAll("{{YOUR_AWS_REGION}}", region);
        const fluentBitDashboard = new cloudwatch.CfnDashboard(this, "FluentBitDashboard", {
            dashboardName: "EKS_FluentBit_Dashboard",
            dashboardBody: dashboardBody
        });
        const customWidgetResourceControllerPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'ecs:ListServices',
                'ecs:UpdateService',
                'eks:DescribeNodegroup',
                'eks:ListNodegroups',
                'eks:DescribeUpdate',
                'eks:UpdateNodegroupConfig',
                'ecs:DescribeServices',
                'eks:DescribeCluster',
                'eks:ListClusters',
                'ecs:ListClusters'
            ],
            resources: ['*']
        });
        var customWidgetLambdaRole = new iam.Role(this, 'customWidgetLambdaRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        });
        customWidgetLambdaRole.addToPrincipalPolicy(customWidgetResourceControllerPolicy);
        var petsiteApplicationResourceController = new lambda.Function(this, 'petsite-application-resource-controler', {
            code: lambda.Code.fromAsset(path.join(__dirname, '/../resources/resource-controller-widget')),
            handler: 'petsite-application-resource-controler.lambda_handler',
            memorySize: 128,
            runtime: lambda.Runtime.PYTHON_3_9,
            role: customWidgetLambdaRole,
            timeout: aws_cdk_lib_1.Duration.minutes(10)
        });
        petsiteApplicationResourceController.addEnvironment("EKS_CLUSTER_NAME", cluster.clusterName);
        petsiteApplicationResourceController.addEnvironment("ECS_CLUSTER_ARNS", ecsPayForAdoptionCluster.clusterArn + "," +
            ecsPetListAdoptionCluster.clusterArn + "," + ecsPetSearchCluster.clusterArn);
        var customWidgetFunction = new lambda.Function(this, 'cloudwatch-custom-widget', {
            code: lambda.Code.fromAsset(path.join(__dirname, '/../resources/resource-controller-widget')),
            handler: 'cloudwatch-custom-widget.lambda_handler',
            memorySize: 128,
            runtime: lambda.Runtime.PYTHON_3_9,
            role: customWidgetLambdaRole,
            timeout: aws_cdk_lib_1.Duration.seconds(60)
        });
        customWidgetFunction.addEnvironment("CONTROLER_LAMBDA_ARN", petsiteApplicationResourceController.functionArn);
        customWidgetFunction.addEnvironment("EKS_CLUSTER_NAME", cluster.clusterName);
        customWidgetFunction.addEnvironment("ECS_CLUSTER_ARNS", ecsPayForAdoptionCluster.clusterArn + "," +
            ecsPetListAdoptionCluster.clusterArn + "," + ecsPetSearchCluster.clusterArn);
        var costControlDashboardBody = (0, fs_1.readFileSync)("./resources/cw_dashboard_cost_control.json", "utf-8");
        costControlDashboardBody = costControlDashboardBody.replaceAll("{{YOUR_LAMBDA_ARN}}", customWidgetFunction.functionArn);
        const petSiteCostControlDashboard = new cloudwatch.CfnDashboard(this, "PetSiteCostControlDashboard", {
            dashboardName: "PetSite_Cost_Control_Dashboard",
            dashboardBody: costControlDashboardBody
        });
        // Creating AWS Resource Group for all the resources of stack.
        const servicesCfnGroup = new resourcegroups.CfnGroup(this, 'ServicesCfnGroup', {
            name: stackName,
            description: 'Contains all the resources deployed by Cloudformation Stack ' + stackName,
            resourceQuery: {
                type: 'CLOUDFORMATION_STACK_1_0',
            }
        });
        // Enabling CloudWatch Application Insights for Resource Group
        const servicesCfnApplication = new applicationinsights.CfnApplication(this, 'ServicesApplicationInsights', {
            resourceGroupName: servicesCfnGroup.name,
            autoConfigurationEnabled: true,
            cweMonitorEnabled: true,
            opsCenterEnabled: true,
        });
        // Adding dependency to create these resources at last
        servicesCfnGroup.node.addDependency(petSiteCostControlDashboard);
        servicesCfnApplication.node.addDependency(servicesCfnGroup);
        // Adding a Lambda function to produce the errors - manually executed
        var dynamodbQueryLambdaRole = new iam.Role(this, 'dynamodbQueryLambdaRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromManagedPolicyArn(this, 'manageddynamodbread', 'arn:aws:iam::aws:policy/AmazonDynamoDBReadOnlyAccess'),
                iam.ManagedPolicy.fromManagedPolicyArn(this, 'lambdaBasicExecRoletoddb', 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole')
            ]
        });
        var dynamodbQueryFunction = new lambda.Function(this, 'dynamodb-query-function', {
            code: lambda.Code.fromAsset(path.join(__dirname, '/../resources/application-insights')),
            handler: 'dynamodb-query-function.lambda_handler',
            memorySize: 128,
            runtime: lambda.Runtime.PYTHON_3_9,
            role: dynamodbQueryLambdaRole,
            timeout: aws_cdk_lib_1.Duration.seconds(900)
        });
        dynamodbQueryFunction.addEnvironment("DYNAMODB_TABLE_NAME", dynamodb_petadoption.tableName);
        this.createOuputs(new Map(Object.entries({
            'CWServiceAccountArn': cwserviceaccount.roleArn,
            'XRayServiceAccountArn': xrayserviceaccount.roleArn,
            'OIDCProviderUrl': cluster.clusterOpenIdConnectIssuerUrl,
            'OIDCProviderArn': cluster.openIdConnectProvider.openIdConnectProviderArn,
            'PetSiteUrl': `http://${alb.loadBalancerDnsName}`,
            'DynamoDBQueryFunction': dynamodbQueryFunction.functionName
        })));
        const petAdoptionsStepFn = new stepfn_1.PetAdoptionsStepFn(this, 'StepFn');
        this.createSsmParameters(new Map(Object.entries({
            '/petstore/trafficdelaytime': "60",
            '/petstore/rumscript': " ",
            '/petstore/petadoptionsstepfnarn': petAdoptionsStepFn.stepFn.stateMachineArn,
            '/petstore/updateadoptionstatusurl': statusUpdaterService.api.url,
            '/petstore/queueurl': sqsQueue.queueUrl,
            '/petstore/snsarn': topic_petadoption.topicArn,
            '/petstore/dynamodbtablename': dynamodb_petadoption.tableName,
            '/petstore/s3bucketname': s3_observabilitypetadoptions.bucketName,
            '/petstore/searchapiurl': `http://${searchService.service.loadBalancer.loadBalancerDnsName}/api/search?`,
            '/petstore/searchimage': searchService.container.imageName,
            '/petstore/petlistadoptionsurl': `http://${listAdoptionsService.service.loadBalancer.loadBalancerDnsName}/api/adoptionlist/`,
            '/petstore/petlistadoptionsmetricsurl': `http://${listAdoptionsService.service.loadBalancer.loadBalancerDnsName}/metrics`,
            '/petstore/paymentapiurl': `http://${payForAdoptionService.service.loadBalancer.loadBalancerDnsName}/api/home/completeadoption`,
            '/petstore/payforadoptionmetricsurl': `http://${payForAdoptionService.service.loadBalancer.loadBalancerDnsName}/metrics`,
            '/petstore/cleanupadoptionsurl': `http://${payForAdoptionService.service.loadBalancer.loadBalancerDnsName}/api/home/cleanupadoptions`,
            '/petstore/petsearch-collector-manual-config': (0, fs_1.readFileSync)("./resources/collector/ecs-xray-manual.yaml", "utf8"),
            '/petstore/rdssecretarn': `${(_m = auroraCluster.secret) === null || _m === void 0 ? void 0 : _m.secretArn}`,
            '/petstore/rdsendpoint': auroraCluster.clusterEndpoint.hostname,
            '/petstore/stackname': stackName,
            '/petstore/petsiteurl': `http://${alb.loadBalancerDnsName}`,
            '/petstore/pethistoryurl': `http://${alb.loadBalancerDnsName}/petadoptionshistory`,
            '/eks/petsite/OIDCProviderUrl': cluster.clusterOpenIdConnectIssuerUrl,
            '/eks/petsite/OIDCProviderArn': cluster.openIdConnectProvider.openIdConnectProviderArn,
            '/petstore/errormode1': "false"
        })));
        this.createOuputs(new Map(Object.entries({
            'QueueURL': sqsQueue.queueUrl,
            'UpdateAdoptionStatusurl': statusUpdaterService.api.url,
            'SNSTopicARN': topic_petadoption.topicArn,
            'RDSServerName': auroraCluster.clusterEndpoint.hostname
        })));
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
exports.Services = Services;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VydmljZXMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJzZXJ2aWNlcy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSwyQ0FBMkM7QUFDM0MsMkNBQTJDO0FBQzNDLDJDQUEyQztBQUMzQywyQ0FBMEM7QUFDMUMsMkNBQTBDO0FBQzFDLDBEQUF5RDtBQUN6RCxnREFBK0M7QUFDL0MseUNBQXdDO0FBQ3hDLDBEQUF5RDtBQUN6RCwyQ0FBMkM7QUFDM0MsMkNBQTJDO0FBQzNDLDJDQUEyQztBQUMzQywyQ0FBMkM7QUFDM0MsZ0NBQWdDO0FBQ2hDLDZCQUE2QjtBQUM3QixpREFBaUQ7QUFDakQsZ0VBQWdFO0FBRWhFLHlEQUF5RDtBQUd6RCwyRUFBMkU7QUFDM0UsaUVBQWlFO0FBR2pFLGtGQUEyRTtBQUMzRSw4RUFBd0U7QUFDeEUsOERBQXlEO0FBQ3pELG9GQUE4RTtBQUM5RSw4RUFBd0U7QUFDeEUsOENBQXNEO0FBQ3RELGlEQUF3RDtBQUN4RCw2Q0FBaUc7QUFDakcsMkJBQWtDO0FBQ2xDLDBCQUF1QjtBQUN2QiwrREFBa0Y7QUFDbEYsMkVBQWdFO0FBQ2hFLGtEQUEwRDtBQUUxRCxNQUFhLFFBQVMsU0FBUSxtQkFBSztJQUMvQixZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQWtCOztRQUN4RCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixJQUFJLGFBQWEsR0FBRyxPQUFPLENBQUM7UUFDNUIsSUFBSSxJQUFJLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxpQkFBaUIsQ0FBQyxJQUFJLFNBQVMsRUFDM0QsQ0FBQztZQUNHLGFBQWEsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDO1FBQy9ELENBQUM7UUFFRCxNQUFNLFNBQVMsR0FBRyxFQUFFLENBQUM7UUFFckIsdURBQXVEO1FBQ3ZELE1BQU0sUUFBUSxHQUFHLElBQUksR0FBRyxD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LENBQUM7WUFDckMsVUFBVSxFQUFFLFFBQVEsQ0FBQyxRQUFRO1lBQzdCLHlCQUF5QixFQUFFLG9CQUFvQixDQUFDLEdBQUcsQ0FBQyxHQUFHO1lBQ3ZELGFBQWEsRUFBRSxpQkFBaUIsQ0FBQyxRQUFRO1lBQ3pDLGVBQWUsRUFBRSxhQUFhLENBQUMsZUFBZSxDQUFDLFFBQVE7U0FDMUQsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUNULENBQUM7SUFFTyxtQkFBbUIsQ0FBQyxNQUEyQjtRQUNuRCxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsS0FBSyxFQUFFLEdBQUcsRUFBRSxFQUFFO1lBQzFCLG1DQUFtQztZQUNuQyxJQUFJLEdBQUcsQ0FBQyxlQUFlLENBQUMsSUFBSSxFQUFFLEdBQUcsRUFBRSxFQUFFLGFBQWEsRUFBRSxHQUFHLEVBQUUsV0FBVyxFQUFFLEtBQUssRUFBRSxDQUFDLENBQUM7UUFDbkYsQ0FBQyxDQUFDLENBQUM7SUFDUCxDQUFDO0lBRU8sWUFBWSxDQUFDLE1BQTJCO1FBQzVDLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQyxLQUFLLEVBQUUsR0FBRyxFQUFFLEVBQUU7WUFDMUIsSUFBSSx1QkFBUyxDQUFDLElBQUksRUFBRSxHQUFHLEVBQUUsRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLENBQUMsQ0FBQTtRQUM5QyxDQUFDLENBQUMsQ0FBQztJQUNQLENBQUM7Q0FDSjtBQXB0QkQsNEJBb3RCQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCAqIGFzIGVjMiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWMyJztcbmltcG9ydCAqIGFzIGVjcyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWNzJztcbmltcG9ydCAqIGFzIHNucyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc25zJ1xuaW1wb3J0ICogYXMgc3FzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zcXMnXG5pbXBvcnQgKiBhcyBzdWJzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zbnMtc3Vic2NyaXB0aW9ucydcbmltcG9ydCAqIGFzIGRkYiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGInXG5pbXBvcnQgKiBhcyBzMyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMnXG5pbXBvcnQgKiBhcyBzM3NlZWRlciBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMtZGVwbG95bWVudCdcbmltcG9ydCAqIGFzIHJkcyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtcmRzJztcbmltcG9ydCAqIGFzIHNzbSBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3NtJztcbmltcG9ydCAqIGFzIGttcyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mta21zJztcbmltcG9ydCAqIGFzIGVrcyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWtzJztcbmltcG9ydCAqIGFzIHlhbWwgZnJvbSAnanMteWFtbCc7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xuaW1wb3J0ICogYXMgZWxidjIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVsYXN0aWNsb2FkYmFsYW5jaW5ndjInO1xuaW1wb3J0ICogYXMgY2xvdWQ5IGZyb20gJ2F3cy1jZGstbGliL2F3cy1jbG91ZDknO1xuaW1wb3J0ICogYXMgY2xvdWR3YXRjaCBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY2xvdWR3YXRjaCc7XG5pbXBvcnQgKiBhcyBlY3IgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjcic7XG5pbXBvcnQgKiBhcyBlY3Jhc3NldHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjci1hc3NldHMnO1xuaW1wb3J0ICogYXMgYXBwbGljYXRpb25pbnNpZ2h0cyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtYXBwbGljYXRpb25pbnNpZ2h0cyc7XG5pbXBvcnQgKiBhcyByZXNvdXJjZWdyb3VwcyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtcmVzb3VyY2Vncm91cHMnO1xuXG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJ1xuaW1wb3J0IHsgUGF5Rm9yQWRvcHRpb25TZXJ2aWNlIH0gZnJvbSAnLi9zZXJ2aWNlcy9wYXktZm9yLWFkb3B0aW9uLXNlcnZpY2UnXG5pbXBvcnQgeyBMaXN0QWRvcHRpb25zU2VydmljZSB9IGZyb20gJy4vc2VydmljZXMvbGlzdC1hZG9wdGlvbnMtc2VydmljZSdcbmltcG9ydCB7IFNlYXJjaFNlcnZpY2UgfSBmcm9tICcuL3NlcnZpY2VzL3NlYXJjaC1zZXJ2aWNlJ1xuaW1wb3J0IHsgVHJhZmZpY0dlbmVyYXRvclNlcnZpY2UgfSBmcm9tICcuL3NlcnZpY2VzL3RyYWZmaWMtZ2VuZXJhdG9yLXNlcnZpY2UnXG5pbXBvcnQgeyBTdGF0dXNVcGRhdGVyU2VydmljZSB9IGZyb20gJy4vc2VydmljZXMvc3RhdHVzLXVwZGF0ZXItc2VydmljZSdcbmltcG9ydCB7IFBldEFkb3B0aW9uc1N0ZXBGbiB9IGZyb20gJy4vc2VydmljZXMvc3RlcGZuJ1xuaW1wb3J0IHsgS3ViZXJuZXRlc1ZlcnNpb24gfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWtzJztcbmltcG9ydCB7IENmbkpzb24sIFJlbW92YWxQb2xpY3ksIEZuLCBEdXJhdGlvbiwgU3RhY2ssIFN0YWNrUHJvcHMsIENmbk91dHB1dCB9IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IHJlYWRGaWxlU3luYyB9IGZyb20gJ2ZzJztcbmltcG9ydCAndHMtcmVwbGFjZS1hbGwnXG5pbXBvcnQgeyBUcmVhdE1pc3NpbmdEYXRhLCBDb21wYXJpc29uT3BlcmF0b3IgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY2xvdWR3YXRjaCc7XG5pbXBvcnQgeyBLdWJlY3RsTGF5ZXIgfSBmcm9tICdhd3MtY2RrLWxpYi9sYW1iZGEtbGF5ZXIta3ViZWN0bCc7XG5pbXBvcnQgeyBDbG91ZDlFbnZpcm9ubWVudCB9IGZyb20gJy4vbW9kdWxlcy9jb3JlL2Nsb3VkOSc7XG5cbmV4cG9ydCBjbGFzcyBTZXJ2aWNlcyBleHRlbmRzIFN0YWNrIHtcbiAgICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IFN0YWNrUHJvcHMpIHtcbiAgICAgICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICAgICAgdmFyIGlzRXZlbnRFbmdpbmUgPSAnZmFsc2UnO1xuICAgICAgICBpZiAodGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ2lzX2V2ZW50X2VuZ2luZScpICE9IHVuZGVmaW5lZClcbiAgICAgICAge1xuICAgICAgICAgICAgaXNFdmVudEVuZ2luZSA9IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdpc19ldmVudF9lbmdpbmUnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHN0YWNrTmFtZSA9IGlkO1xuXG4gICAgICAgIC8vIENyZWF0ZSBTUVMgcmVzb3VyY2UgdG8gc2VuZCBQZXQgYWRvcHRpb24gbWVzc2FnZXMgdG9cbiAgICAgICAgY29uc3Qgc3FzUXVldWUgPSBuZXcgc3FzLlF1ZXVlKHRoaXMsICdzcXNfcGV0YWRvcHRpb24nLCB7XG4gICAgICAgICAgICB2aXNpYmlsaXR5VGltZW91dDogRHVyYXRpb24uc2Vjb25kcygzMDApXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIENyZWF0ZSBTTlMgYW5kIGFuIGVtYWlsIHRvcGljIHRvIHNlbmQgbm90aWZpY2F0aW9ucyB0b1xuICAgICAgICBjb25zdCB0b3BpY19wZXRhZG9wdGlvbiA9IG5ldyBzbnMuVG9waWModGhpcywgJ3RvcGljX3BldGFkb3B0aW9uJyk7XG4gICAgICAgIHZhciB0b3BpY19lbWFpbCA9IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdzbnN0b3BpY19lbWFpbCcpO1xuICAgICAgICBpZiAodG9waWNfZW1haWwgPT0gdW5kZWZpbmVkKVxuICAgICAgICB7XG4gICAgICAgICAgICB0b3BpY19lbWFpbCA9IFwic29tZW9uZUBleGFtcGxlLmNvbVwiO1xuICAgICAgICB9XG4gICAgICAgIHRvcGljX3BldGFkb3B0aW9uLmFkZFN1YnNjcmlwdGlvbihuZXcgc3Vicy5FbWFpbFN1YnNjcmlwdGlvbih0b3BpY19lbWFpbCkpO1xuXG4gICAgICAgIC8vIENyZWF0ZXMgYW4gUzMgYnVja2V0IHRvIHN0b3JlIHBldCBpbWFnZXNcbiAgICAgICAgY29uc3QgczNfb2JzZXJ2YWJpbGl0eXBldGFkb3B0aW9ucyA9IG5ldyBzMy5CdWNrZXQodGhpcywgJ3MzYnVja2V0X3BldGFkb3B0aW9uJywge1xuICAgICAgICAgICAgcHVibGljUmVhZEFjY2VzczogZmFsc2UsXG4gICAgICAgICAgICBhdXRvRGVsZXRlT2JqZWN0czogdHJ1ZSxcbiAgICAgICAgICAgIHJlbW92YWxQb2xpY3k6IFJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gQ3JlYXRlcyB0aGUgRHluYW1vREIgdGFibGUgZm9yIFBldGFkb3B0aW9uIGRhdGFcbiAgICAgICAgY29uc3QgZHluYW1vZGJfcGV0YWRvcHRpb24gPSBuZXcgZGRiLlRhYmxlKHRoaXMsICdkZGJfcGV0YWRvcHRpb24nLCB7XG4gICAgICAgICAgICBwYXJ0aXRpb25LZXk6IHtcbiAgICAgICAgICAgICAgICBuYW1lOiAncGV0dHlwZScsXG4gICAgICAgICAgICAgICAgdHlwZTogZGRiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgc29ydEtleToge1xuICAgICAgICAgICAgICAgIG5hbWU6ICdwZXRpZCcsXG4gICAgICAgICAgICAgICAgdHlwZTogZGRiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcmVhZENhcGFjaXR5OiAyMDAwLFxuICAgICAgICAgICAgcmVtb3ZhbFBvbGljeTogIFJlbW92YWxQb2xpY3kuREVTVFJPWVxuICAgICAgICB9KTtcblxuICAgICAgICBkeW5hbW9kYl9wZXRhZG9wdGlvbi5tZXRyaWMoJ1dyaXRlVGhyb3R0bGVFdmVudHMnLHtzdGF0aXN0aWM6XCJhdmdcIn0pLmNyZWF0ZUFsYXJtKHRoaXMsICdXcml0ZVRocm90dGxlRXZlbnRzLUJhc2ljQWxhcm0nLCB7XG4gICAgICAgICAgdGhyZXNob2xkOiAwLFxuICAgICAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IFRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElORyxcbiAgICAgICAgICBjb21wYXJpc29uT3BlcmF0b3I6IENvbXBhcmlzb25PcGVyYXRvci5HUkVBVEVSX1RIQU5fVEhSRVNIT0xELFxuICAgICAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAxLFxuICAgICAgICAgIGFsYXJtTmFtZTogYCR7ZHluYW1vZGJfcGV0YWRvcHRpb24udGFibGVOYW1lfS1Xcml0ZVRocm90dGxlRXZlbnRzLUJhc2ljQWxhcm1gLFxuICAgICAgICB9KTtcblxuICAgICAgICBkeW5hbW9kYl9wZXRhZG9wdGlvbi5tZXRyaWMoJ1JlYWRUaHJvdHRsZUV2ZW50cycse3N0YXRpc3RpYzpcImF2Z1wifSkuY3JlYXRlQWxhcm0odGhpcywgJ1JlYWRUaHJvdHRsZUV2ZW50cy1CYXNpY0FsYXJtJywge1xuICAgICAgICAgIHRocmVzaG9sZDogMCxcbiAgICAgICAgICB0cmVhdE1pc3NpbmdEYXRhOiBUcmVhdE1pc3NpbmdEYXRhLk5PVF9CUkVBQ0hJTkcsXG4gICAgICAgICAgY29tcGFyaXNvbk9wZXJhdG9yOiBDb21wYXJpc29uT3BlcmF0b3IuR1JFQVRFUl9USEFOX1RIUkVTSE9MRCxcbiAgICAgICAgICBldmFsdWF0aW9uUGVyaW9kczogMSxcbiAgICAgICAgICBhbGFybU5hbWU6IGAke2R5bmFtb2RiX3BldGFkb3B0aW9uLnRhYmxlTmFtZX0tUmVhZFRocm90dGxlRXZlbnRzLUJhc2ljQWxhcm1gLFxuICAgICAgICB9KTtcblxuXG4gICAgICAgIC8vIFNlZWRzIHRoZSBTMyBidWNrZXQgd2l0aCBwZXQgaW1hZ2VzXG4gICAgICAgIG5ldyBzM3NlZWRlci5CdWNrZXREZXBsb3ltZW50KHRoaXMsIFwiczNzZWVkZXJfcGV0YWRvcHRpb25cIiwge1xuICAgICAgICAgICAgZGVzdGluYXRpb25CdWNrZXQ6IHMzX29ic2VydmFiaWxpdHlwZXRhZG9wdGlvbnMsXG4gICAgICAgICAgICBzb3VyY2VzOiBbczNzZWVkZXIuU291cmNlLmFzc2V0KCcuL3Jlc291cmNlcy9raXR0ZW4uemlwJyksIHMzc2VlZGVyLlNvdXJjZS5hc3NldCgnLi9yZXNvdXJjZXMvcHVwcGllcy56aXAnKSwgczNzZWVkZXIuU291cmNlLmFzc2V0KCcuL3Jlc291cmNlcy9idW5uaWVzLnppcCcpXVxuICAgICAgICB9KTtcblxuXG4gICAgICAgIHZhciBjaWRyUmFuZ2UgPSB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgndnBjX2NpZHInKTtcbiAgICAgICAgaWYgKGNpZHJSYW5nZSA9PSB1bmRlZmluZWQpXG4gICAgICAgIHtcbiAgICAgICAgICAgIGNpZHJSYW5nZSA9IFwiMTEuMC4wLjAvMTZcIjtcbiAgICAgICAgfVxuICAgICAgICAvLyBUaGUgVlBDIHdoZXJlIGFsbCB0aGUgbWljcm9zZXJ2aWNlcyB3aWxsIGJlIGRlcGxveWVkIGludG9cbiAgICAgICAgY29uc3QgdGhlVlBDID0gbmV3IGVjMi5WcGModGhpcywgJ01pY3Jvc2VydmljZXMnLCB7XG4gICAgICAgICAgICBpcEFkZHJlc3NlczogZWMyLklwQWRkcmVzc2VzLmNpZHIoY2lkclJhbmdlKSxcbiAgICAgICAgICAgIC8vIGNpZHI6IGNpZHJSYW5nZSxcbiAgICAgICAgICAgIG5hdEdhdGV3YXlzOiAxLFxuICAgICAgICAgICAgbWF4QXpzOiAyXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIENyZWF0ZSBSRFMgQXVyb3JhIFBHIGNsdXN0ZXJcbiAgICAgICAgY29uc3QgcmRzc2VjdXJpdHlncm91cCA9IG5ldyBlYzIuU2VjdXJpdHlHcm91cCh0aGlzLCAncGV0YWRvcHRpb25zcmRzU0cnLCB7XG4gICAgICAgICAgICB2cGM6IHRoZVZQQ1xuICAgICAgICB9KTtcblxuICAgICAgICByZHNzZWN1cml0eWdyb3VwLmFkZEluZ3Jlc3NSdWxlKGVjMi5QZWVyLmlwdjQodGhlVlBDLnZwY0NpZHJCbG9jayksIGVjMi5Qb3J0LnRjcCg1NDMyKSwgJ0FsbG93IEF1cm9yYSBQRyBhY2Nlc3MgZnJvbSB3aXRoaW4gdGhlIFZQQyBDSURSIHJhbmdlJyk7XG5cbiAgICAgICAgdmFyIHJkc1VzZXJuYW1lID0gdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ3Jkc3VzZXJuYW1lJyk7XG4gICAgICAgIGlmIChyZHNVc2VybmFtZSA9PSB1bmRlZmluZWQpXG4gICAgICAgIHtcbiAgICAgICAgICAgIHJkc1VzZXJuYW1lID0gXCJwZXRhZG1pblwiXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBhdXJvcmFDbHVzdGVyID0gbmV3IHJkcy5TZXJ2ZXJsZXNzQ2x1c3Rlcih0aGlzLCAnRGF0YWJhc2UnLCB7XG5cbiAgICAgICAgICAgIGVuZ2luZTogcmRzLkRhdGFiYXNlQ2x1c3RlckVuZ2luZS5hdXJvcmFQb3N0Z3Jlcyh7IHZlcnNpb246IHJkcy5BdXJvcmFQb3N0Z3Jlc0VuZ2luZVZlcnNpb24uVkVSXzEzXzkgfSksXG4gXG4gICAgICAgICAgICBwYXJhbWV0ZXJHcm91cDogcmRzLlBhcmFtZXRlckdyb3VwLmZyb21QYXJhbWV0ZXJHcm91cE5hbWUodGhpcywgJ1BhcmFtZXRlckdyb3VwJywgJ2RlZmF1bHQuYXVyb3JhLXBvc3RncmVzcWwxMycpLFxuICAgICAgICAgICAgdnBjOiB0aGVWUEMsXG4gICAgICAgICAgICBzZWN1cml0eUdyb3VwczogW3Jkc3NlY3VyaXR5Z3JvdXBdLFxuICAgICAgICAgICAgZGVmYXVsdERhdGFiYXNlTmFtZTogJ2Fkb3B0aW9ucycsXG4gICAgICAgICAgICBzY2FsaW5nOiB7XG4gICAgICAgICAgICAgICAgYXV0b1BhdXNlOiBEdXJhdGlvbi5taW51dGVzKDYwKSxcbiAgICAgICAgICAgICAgICBtaW5DYXBhY2l0eTogcmRzLkF1cm9yYUNhcGFjaXR5VW5pdC5BQ1VfMixcbiAgICAgICAgICAgICAgICBtYXhDYXBhY2l0eTogcmRzLkF1cm9yYUNhcGFjaXR5VW5pdC5BQ1VfOCxcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cblxuICAgICAgICBjb25zdCByZWFkU1NNUGFyYW1zUG9saWN5ID0gbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgICAgICdzc206R2V0UGFyYW1ldGVyc0J5UGF0aCcsXG4gICAgICAgICAgICAgICAgJ3NzbTpHZXRQYXJhbWV0ZXJzJyxcbiAgICAgICAgICAgICAgICAnc3NtOkdldFBhcmFtZXRlcicsXG4gICAgICAgICAgICAgICAgJ2VjMjpEZXNjcmliZVZwY3MnXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgcmVzb3VyY2VzOiBbJyonXVxuICAgICAgICB9KTtcblxuXG4gICAgICAgIGNvbnN0IGRkYlNlZWRQb2xpY3kgPSBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAgICAgJ2R5bmFtb2RiOkJhdGNoV3JpdGVJdGVtJyxcbiAgICAgICAgICAgICAgICAnZHluYW1vZGI6TGlzdFRhYmxlcycsXG4gICAgICAgICAgICAgICAgXCJkeW5hbW9kYjpTY2FuXCIsXG4gICAgICAgICAgICAgICAgXCJkeW5hbW9kYjpRdWVyeVwiXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgcmVzb3VyY2VzOiBbJyonXVxuICAgICAgICB9KTtcblxuICAgICAgICBjb25zdCByZXBvc2l0b3J5VVJJID0gXCJwdWJsaWMuZWNyLmF3cy9vbmUtb2JzZXJ2YWJpbGl0eS13b3Jrc2hvcFwiO1xuXG4gICAgICAgIGNvbnN0IHN0YWNrID0gU3RhY2sub2YodGhpcyk7XG4gICAgICAgIGNvbnN0IHJlZ2lvbiA9IHN0YWNrLnJlZ2lvbjtcblxuICAgICAgICBjb25zdCBlY3NTZXJ2aWNlc1NlY3VyaXR5R3JvdXAgPSBuZXcgZWMyLlNlY3VyaXR5R3JvdXAodGhpcywgJ0VDU1NlcnZpY2VzU0cnLCB7XG4gICAgICAgICAgICB2cGM6IHRoZVZQQ1xuICAgICAgICB9KTtcblxuICAgICAgICBlY3NTZXJ2aWNlc1NlY3VyaXR5R3JvdXAuYWRkSW5ncmVzc1J1bGUoZWMyLlBlZXIuaXB2NCh0aGVWUEMudnBjQ2lkckJsb2NrKSwgZWMyLlBvcnQudGNwKDgwKSk7XG5cbiAgICAgICAgY29uc3QgZWNzUGF5Rm9yQWRvcHRpb25DbHVzdGVyID0gbmV3IGVjcy5DbHVzdGVyKHRoaXMsIFwiUGF5Rm9yQWRvcHRpb25cIiwge1xuICAgICAgICAgICAgdnBjOiB0aGVWUEMsXG4gICAgICAgICAgICBjb250YWluZXJJbnNpZ2h0czogZmFsc2VcbiAgICAgICAgfSk7XG4gICAgICAgIC8vIFBheUZvckFkb3B0aW9uIHNlcnZpY2UgZGVmaW5pdGlvbnMtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgICAgICBjb25zdCBwYXlGb3JBZG9wdGlvblNlcnZpY2UgPSBuZXcgUGF5Rm9yQWRvcHRpb25TZXJ2aWNlKHRoaXMsICdwYXktZm9yLWFkb3B0aW9uLXNlcnZpY2UnLCB7XG4gICAgICAgICAgICBjbHVzdGVyOiBlY3NQYXlGb3JBZG9wdGlvbkNsdXN0ZXIsXG4gICAgICAgICAgICBsb2dHcm91cE5hbWU6IFwiL2Vjcy9QYXlGb3JBZG9wdGlvblwiLFxuICAgICAgICAgICAgY3B1OiAxMDI0LFxuICAgICAgICAgICAgbWVtb3J5TGltaXRNaUI6IDIwNDgsXG4gICAgICAgICAgICBoZWFsdGhDaGVjazogJy9oZWFsdGgvc3RhdHVzJyxcbiAgICAgICAgICAgIC8vIGJ1aWxkIGxvY2FsbHlcbiAgICAgICAgICAgIC8vcmVwb3NpdG9yeVVSSTogcmVwb3NpdG9yeVVSSSxcbiAgICAgICAgICAgIGRhdGFiYXNlOiBhdXJvcmFDbHVzdGVyLFxuICAgICAgICAgICAgZGVzaXJlZFRhc2tDb3VudCA6IDIsXG4gICAgICAgICAgICByZWdpb246IHJlZ2lvbixcbiAgICAgICAgICAgIHNlY3VyaXR5R3JvdXA6IGVjc1NlcnZpY2VzU2VjdXJpdHlHcm91cFxuICAgICAgICB9KTtcbiAgICAgICAgcGF5Rm9yQWRvcHRpb25TZXJ2aWNlLnRhc2tEZWZpbml0aW9uLnRhc2tSb2xlPy5hZGRUb1ByaW5jaXBhbFBvbGljeShyZWFkU1NNUGFyYW1zUG9saWN5KTtcbiAgICAgICAgcGF5Rm9yQWRvcHRpb25TZXJ2aWNlLnRhc2tEZWZpbml0aW9uLnRhc2tSb2xlPy5hZGRUb1ByaW5jaXBhbFBvbGljeShkZGJTZWVkUG9saWN5KTtcblxuXG4gICAgICAgIGNvbnN0IGVjc1BldExpc3RBZG9wdGlvbkNsdXN0ZXIgPSBuZXcgZWNzLkNsdXN0ZXIodGhpcywgXCJQZXRMaXN0QWRvcHRpb25zXCIsIHtcbiAgICAgICAgICAgIHZwYzogdGhlVlBDLFxuICAgICAgICAgICAgY29udGFpbmVySW5zaWdodHM6IGZhbHNlXG4gICAgICAgIH0pO1xuICAgICAgICAvLyBQZXRMaXN0QWRvcHRpb25zIHNlcnZpY2UgZGVmaW5pdGlvbnMtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgICAgICBjb25zdCBsaXN0QWRvcHRpb25zU2VydmljZSA9IG5ldyBMaXN0QWRvcHRpb25zU2VydmljZSh0aGlzLCAnbGlzdC1hZG9wdGlvbnMtc2VydmljZScsIHtcbiAgICAgICAgICAgIGNsdXN0ZXI6IGVjc1BldExpc3RBZG9wdGlvbkNsdXN0ZXIsXG4gICAgICAgICAgICBsb2dHcm91cE5hbWU6IFwiL2Vjcy9QZXRMaXN0QWRvcHRpb25zXCIsXG4gICAgICAgICAgICBjcHU6IDEwMjQsXG4gICAgICAgICAgICBtZW1vcnlMaW1pdE1pQjogMjA0OCxcbiAgICAgICAgICAgIGhlYWx0aENoZWNrOiAnL2hlYWx0aC9zdGF0dXMnLFxuICAgICAgICAgICAgaW5zdHJ1bWVudGF0aW9uOiAnb3RlbCcsXG4gICAgICAgICAgICAvLyBidWlsZCBsb2NhbGx5XG4gICAgICAgICAgICAvL3JlcG9zaXRvcnlVUkk6IHJlcG9zaXRvcnlVUkksXG4gICAgICAgICAgICBkYXRhYmFzZTogYXVyb3JhQ2x1c3RlcixcbiAgICAgICAgICAgIGRlc2lyZWRUYXNrQ291bnQ6IDIsXG4gICAgICAgICAgICByZWdpb246IHJlZ2lvbixcbiAgICAgICAgICAgIHNlY3VyaXR5R3JvdXA6IGVjc1NlcnZpY2VzU2VjdXJpdHlHcm91cFxuICAgICAgICB9KTtcbiAgICAgICAgbGlzdEFkb3B0aW9uc1NlcnZpY2UudGFza0RlZmluaXRpb24udGFza1JvbGU/LmFkZFRvUHJpbmNpcGFsUG9saWN5KHJlYWRTU01QYXJhbXNQb2xpY3kpO1xuXG4gICAgICAgIGNvbnN0IGVjc1BldFNlYXJjaENsdXN0ZXIgPSBuZXcgZWNzLkNsdXN0ZXIodGhpcywgXCJQZXRTZWFyY2hcIiwge1xuICAgICAgICAgICAgdnBjOiB0aGVWUEMsXG4gICAgICAgICAgICBjb250YWluZXJJbnNpZ2h0czogZmFsc2VcbiAgICAgICAgfSk7XG4gICAgICAgIC8vIFBldFNlYXJjaCBzZXJ2aWNlIGRlZmluaXRpb25zLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICAgICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IG5ldyBTZWFyY2hTZXJ2aWNlKHRoaXMsICdzZWFyY2gtc2VydmljZScsIHtcbiAgICAgICAgICAgIGNsdXN0ZXI6IGVjc1BldFNlYXJjaENsdXN0ZXIsXG4gICAgICAgICAgICBsb2dHcm91cE5hbWU6IFwiL2Vjcy9QZXRTZWFyY2hcIixcbiAgICAgICAgICAgIGNwdTogMTAyNCxcbiAgICAgICAgICAgIG1lbW9yeUxpbWl0TWlCOiAyMDQ4LFxuICAgICAgICAgICAgLy9yZXBvc2l0b3J5VVJJOiByZXBvc2l0b3J5VVJJLFxuICAgICAgICAgICAgaGVhbHRoQ2hlY2s6ICcvaGVhbHRoL3N0YXR1cycsXG4gICAgICAgICAgICBkZXNpcmVkVGFza0NvdW50OiAyLFxuICAgICAgICAgICAgaW5zdHJ1bWVudGF0aW9uOiAnb3RlbCcsXG4gICAgICAgICAgICByZWdpb246IHJlZ2lvbixcbiAgICAgICAgICAgIHNlY3VyaXR5R3JvdXA6IGVjc1NlcnZpY2VzU2VjdXJpdHlHcm91cFxuICAgICAgICB9KVxuICAgICAgICBzZWFyY2hTZXJ2aWNlLnRhc2tEZWZpbml0aW9uLnRhc2tSb2xlPy5hZGRUb1ByaW5jaXBhbFBvbGljeShyZWFkU1NNUGFyYW1zUG9saWN5KTtcblxuICAgICAgICAvLyBUcmFmZmljIEdlbmVyYXRvciB0YXNrIGRlZmluaXRpb24uXG4gICAgICAgIGNvbnN0IHRyYWZmaWNHZW5lcmF0b3JTZXJ2aWNlID0gbmV3IFRyYWZmaWNHZW5lcmF0b3JTZXJ2aWNlKHRoaXMsICd0cmFmZmljLWdlbmVyYXRvci1zZXJ2aWNlJywge1xuICAgICAgICAgICAgY2x1c3RlcjogZWNzUGV0TGlzdEFkb3B0aW9uQ2x1c3RlcixcbiAgICAgICAgICAgIGxvZ0dyb3VwTmFtZTogXCIvZWNzL1BldFRyYWZmaWNHZW5lcmF0b3JcIixcbiAgICAgICAgICAgIGNwdTogMjU2LFxuICAgICAgICAgICAgbWVtb3J5TGltaXRNaUI6IDUxMixcbiAgICAgICAgICAgIGluc3RydW1lbnRhdGlvbjogJ25vbmUnLFxuICAgICAgICAgICAgLy9yZXBvc2l0b3J5VVJJOiByZXBvc2l0b3J5VVJJLFxuICAgICAgICAgICAgZGVzaXJlZFRhc2tDb3VudDogMSxcbiAgICAgICAgICAgIHJlZ2lvbjogcmVnaW9uLFxuICAgICAgICAgICAgc2VjdXJpdHlHcm91cDogZWNzU2VydmljZXNTZWN1cml0eUdyb3VwXG4gICAgICAgIH0pXG4gICAgICAgIHRyYWZmaWNHZW5lcmF0b3JTZXJ2aWNlLnRhc2tEZWZpbml0aW9uLnRhc2tSb2xlPy5hZGRUb1ByaW5jaXBhbFBvbGljeShyZWFkU1NNUGFyYW1zUG9saWN5KTtcblxuICAgICAgICAvL1BldFN0YXR1c1VwZGF0ZXIgTGFtYmRhIEZ1bmN0aW9uIGFuZCBBUElHVy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgICAgIGNvbnN0IHN0YXR1c1VwZGF0ZXJTZXJ2aWNlID0gbmV3IFN0YXR1c1VwZGF0ZXJTZXJ2aWNlKHRoaXMsICdzdGF0dXMtdXBkYXRlci1zZXJ2aWNlJywge1xuICAgICAgICAgICAgdGFibGVOYW1lOiBkeW5hbW9kYl9wZXRhZG9wdGlvbi50YWJsZU5hbWVcbiAgICAgICAgfSk7XG5cblxuICAgICAgICBjb25zdCBhbGJTRyA9IG5ldyBlYzIuU2VjdXJpdHlHcm91cCh0aGlzLCdBTEJTZWN1cml0eUdyb3VwJyx7XG4gICAgICAgICAgICB2cGM6IHRoZVZQQyxcbiAgICAgICAgICAgIHNlY3VyaXR5R3JvdXBOYW1lOiAnQUxCU2VjdXJpdHlHcm91cCcsXG4gICAgICAgICAgICBhbGxvd0FsbE91dGJvdW5kOiB0cnVlXG4gICAgICAgIH0pO1xuICAgICAgICBhbGJTRy5hZGRJbmdyZXNzUnVsZShlYzIuUGVlci5hbnlJcHY0KCksZWMyLlBvcnQudGNwKDgwKSk7XG5cbiAgICAgICAgLy8gUGV0U2l0ZSAtIENyZWF0ZSBBTEIgYW5kIFRhcmdldCBHcm91cHNcbiAgICAgICAgY29uc3QgYWxiID0gbmV3IGVsYnYyLkFwcGxpY2F0aW9uTG9hZEJhbGFuY2VyKHRoaXMsICdQZXRTaXRlTG9hZEJhbGFuY2VyJywge1xuICAgICAgICAgICAgdnBjOiB0aGVWUEMsXG4gICAgICAgICAgICBpbnRlcm5ldEZhY2luZzogdHJ1ZSxcbiAgICAgICAgICAgIHNlY3VyaXR5R3JvdXA6IGFsYlNHXG4gICAgICAgIH0pO1xuICAgICAgICB0cmFmZmljR2VuZXJhdG9yU2VydmljZS5ub2RlLmFkZERlcGVuZGVuY3koYWxiKTtcblxuICAgICAgICBjb25zdCB0YXJnZXRHcm91cCA9IG5ldyBlbGJ2Mi5BcHBsaWNhdGlvblRhcmdldEdyb3VwKHRoaXMsICdQZXRTaXRlVGFyZ2V0R3JvdXAnLCB7XG4gICAgICAgICAgICBwb3J0OiA4MCxcbiAgICAgICAgICAgIHByb3RvY29sOiBlbGJ2Mi5BcHBsaWNhdGlvblByb3RvY29sLkhUVFAsXG4gICAgICAgICAgICB2cGM6IHRoZVZQQyxcbiAgICAgICAgICAgIHRhcmdldFR5cGU6IGVsYnYyLlRhcmdldFR5cGUuSVBcblxuICAgICAgICB9KTtcblxuICAgICAgICBuZXcgc3NtLlN0cmluZ1BhcmFtZXRlcih0aGlzLFwicHV0UGFyYW1UYXJnZXRHcm91cEFyblwiLHtcbiAgICAgICAgICAgIHN0cmluZ1ZhbHVlOiB0YXJnZXRHcm91cC50YXJnZXRHcm91cEFybixcbiAgICAgICAgICAgIHBhcmFtZXRlck5hbWU6ICcvZWtzL3BldHNpdGUvVGFyZ2V0R3JvdXBBcm4nXG4gICAgICAgICAgfSlcblxuICAgICAgICBjb25zdCBsaXN0ZW5lciA9IGFsYi5hZGRMaXN0ZW5lcignTGlzdGVuZXInLCB7XG4gICAgICAgICAgICBwb3J0OiA4MCxcbiAgICAgICAgICAgIG9wZW46IHRydWUsXG4gICAgICAgICAgICBkZWZhdWx0VGFyZ2V0R3JvdXBzOiBbdGFyZ2V0R3JvdXBdLFxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBQZXRBZG9wdGlvbkhpc3RvcnkgLSBhdHRhY2ggc2VydmljZSB0byBwYXRoIC9wZXRhZG9wdGlvbmhpc3Rvcnkgb24gUGV0U2l0ZSBBTEJcbiAgICAgICAgY29uc3QgcGV0YWRvcHRpb25zaGlzdG9yeV90YXJnZXRHcm91cCA9IG5ldyBlbGJ2Mi5BcHBsaWNhdGlvblRhcmdldEdyb3VwKHRoaXMsICdQZXRBZG9wdGlvbnNIaXN0b3J5VGFyZ2V0R3JvdXAnLCB7XG4gICAgICAgICAgICBwb3J0OiA4MCxcbiAgICAgICAgICAgIHByb3RvY29sOiBlbGJ2Mi5BcHBsaWNhdGlvblByb3RvY29sLkhUVFAsXG4gICAgICAgICAgICB2cGM6IHRoZVZQQyxcbiAgICAgICAgICAgIHRhcmdldFR5cGU6IGVsYnYyLlRhcmdldFR5cGUuSVAsXG4gICAgICAgICAgICBoZWFsdGhDaGVjazoge1xuICAgICAgICAgICAgICAgIHBhdGg6ICcvaGVhbHRoL3N0YXR1cycsXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGxpc3RlbmVyLmFkZFRhcmdldEdyb3VwcygnUGV0QWRvcHRpb25zSGlzdG9yeVRhcmdldEdyb3VwcycsIHtcbiAgICAgICAgICAgIHByaW9yaXR5OiAxMCxcbiAgICAgICAgICAgIGNvbmRpdGlvbnM6IFtcbiAgICAgICAgICAgICAgICBlbGJ2Mi5MaXN0ZW5lckNvbmRpdGlvbi5wYXRoUGF0dGVybnMoWycvcGV0YWRvcHRpb25zaGlzdG9yeS8qJ10pLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIHRhcmdldEdyb3VwczogW3BldGFkb3B0aW9uc2hpc3RvcnlfdGFyZ2V0R3JvdXBdXG4gICAgICAgIH0pO1xuXG4gICAgICAgIG5ldyBzc20uU3RyaW5nUGFyYW1ldGVyKHRoaXMsXCJwdXRQZXRIaXN0b3J5UGFyYW1UYXJnZXRHcm91cEFyblwiLHtcbiAgICAgICAgICAgIHN0cmluZ1ZhbHVlOiBwZXRhZG9wdGlvbnNoaXN0b3J5X3RhcmdldEdyb3VwLnRhcmdldEdyb3VwQXJuLFxuICAgICAgICAgICAgcGFyYW1ldGVyTmFtZTogJy9la3MvcGV0aGlzdG9yeS9UYXJnZXRHcm91cEFybidcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gUGV0U2l0ZSAtIEVLUyBDbHVzdGVyXG4gICAgICAgIGNvbnN0IGNsdXN0ZXJBZG1pbiA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnQWRtaW5Sb2xlJywge1xuICAgICAgICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLkFjY291bnRSb290UHJpbmNpcGFsKClcbiAgICAgICAgfSk7XG5cbiAgICAgICAgbmV3IHNzbS5TdHJpbmdQYXJhbWV0ZXIodGhpcyxcInB1dFBhcmFtXCIse1xuICAgICAgICAgICAgc3RyaW5nVmFsdWU6IGNsdXN0ZXJBZG1pbi5yb2xlQXJuLFxuICAgICAgICAgICAgcGFyYW1ldGVyTmFtZTogJy9la3MvcGV0c2l0ZS9FS1NNYXN0ZXJSb2xlQXJuJ1xuICAgICAgICAgIH0pXG5cbiAgICAgICAgY29uc3Qgc2VjcmV0c0tleSA9IG5ldyBrbXMuS2V5KHRoaXMsICdTZWNyZXRzS2V5Jyk7XG4gICAgICAgIGNvbnN0IGNsdXN0ZXIgPSBuZXcgZWtzLkNsdXN0ZXIodGhpcywgJ3BldHNpdGUnLCB7XG4gICAgICAgICAgICBjbHVzdGVyTmFtZTogJ1BldFNpdGUnLFxuICAgICAgICAgICAgbWFzdGVyc1JvbGU6IGNsdXN0ZXJBZG1pbixcbiAgICAgICAgICAgIHZwYzogdGhlVlBDLFxuICAgICAgICAgICAgZGVmYXVsdENhcGFjaXR5OiAyLFxuICAgICAgICAgICAgZGVmYXVsdENhcGFjaXR5SW5zdGFuY2U6IGVjMi5JbnN0YW5jZVR5cGUub2YoZWMyLkluc3RhbmNlQ2xhc3MuVDMsIGVjMi5JbnN0YW5jZVNpemUuTUVESVVNKSxcbiAgICAgICAgICAgIHNlY3JldHNFbmNyeXB0aW9uS2V5OiBzZWNyZXRzS2V5LFxuICAgICAgICAgICAgdmVyc2lvbjogS3ViZXJuZXRlc1ZlcnNpb24ub2YoJzEuMjcnKSxcbiAgICAgICAgICAgIGt1YmVjdGxMYXllcjogbmV3IEt1YmVjdGxMYXllcih0aGlzLCAna3ViZWN0bCcpIFxuICAgICAgICB9KTtcblxuICAgICAgICBjb25zdCBjbHVzdGVyU0cgPSBlYzIuU2VjdXJpdHlHcm91cC5mcm9tU2VjdXJpdHlHcm91cElkKHRoaXMsJ0NsdXN0ZXJTRycsY2x1c3Rlci5jbHVzdGVyU2VjdXJpdHlHcm91cElkKTtcbiAgICAgICAgY2x1c3RlclNHLmFkZEluZ3Jlc3NSdWxlKGFsYlNHLGVjMi5Qb3J0LmFsbFRyYWZmaWMoKSwnQWxsb3cgdHJhZmZpYyBmcm9tIHRoZSBBTEInKTtcbiAgICAgICAgY2x1c3RlclNHLmFkZEluZ3Jlc3NSdWxlKGVjMi5QZWVyLmlwdjQodGhlVlBDLnZwY0NpZHJCbG9jayksZWMyLlBvcnQudGNwKDQ0MyksJ0FsbG93IGxvY2FsIGFjY2VzcyB0byBrOHMgYXBpJyk7XG5cblxuICAgICAgICAvLyBBZGQgU1NNIFBlcm1pc3Npb25zIHRvIHRoZSBub2RlIHJvbGVcbiAgICAgICAgY2x1c3Rlci5kZWZhdWx0Tm9kZWdyb3VwPy5yb2xlLmFkZE1hbmFnZWRQb2xpY3koaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKFwiQW1hem9uU1NNTWFuYWdlZEluc3RhbmNlQ29yZVwiKSk7XG5cbiAgICAgICAgLy8gQWRkIENsb3VkV2F0Y2hBZ2VudCBQZXJtaXNzaW9ucyB0byB0aGUgbm9kZSByb2xlXG4gICAgICAgIGNsdXN0ZXIuZGVmYXVsdE5vZGVncm91cD8ucm9sZS5hZGRNYW5hZ2VkUG9saWN5KGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZShcIkNsb3VkV2F0Y2hBZ2VudFNlcnZlclBvbGljeVwiKSk7XG5cbiAgICAgICAgLy8gQWRkIENsb3VkV2F0Y2ggbWV0cmljcyBwZXJtaXNzaW9uXG4gICAgICAgIGNsdXN0ZXIuZGVmYXVsdE5vZGVncm91cD8ucm9sZS5hZGRNYW5hZ2VkUG9saWN5KGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZShcIkNsb3VkV2F0Y2hGdWxsQWNjZXNzXCIpKTtcblxuICAgICAgICAvLyBGcm9tIGh0dHBzOi8vZ2l0aHViLmNvbS9hd3Mtc2FtcGxlcy9zc20tYWdlbnQtZGFlbW9uc2V0LWluc3RhbGxlclxuICAgICAgICB2YXIgc3NtQWdlbnRTZXR1cCA9IHlhbWwubG9hZEFsbChyZWFkRmlsZVN5bmMoXCIuL3Jlc291cmNlcy9zZXR1cC1zc20tYWdlbnQueWFtbFwiLFwidXRmOFwiKSkgYXMgUmVjb3JkPHN0cmluZyxhbnk+W107XG5cbiAgICAgICAgY29uc3Qgc3NtQWdlbnRTZXR1cE1hbmlmZXN0ID0gbmV3IGVrcy5LdWJlcm5ldGVzTWFuaWZlc3QodGhpcyxcInNzbUFnZW50ZGVwbG95bWVudFwiLHtcbiAgICAgICAgICAgIGNsdXN0ZXI6IGNsdXN0ZXIsXG4gICAgICAgICAgICBtYW5pZmVzdDogc3NtQWdlbnRTZXR1cFxuICAgICAgICB9KTtcblxuXG5cbiAgICAgICAgLy8gQ2x1c3RlcklEIGlzIG5vdCBhdmFpbGFibGUgZm9yIGNyZWF0aW5nIHRoZSBwcm9wZXIgY29uZGl0aW9ucyBodHRwczovL2dpdGh1Yi5jb20vYXdzL2F3cy1jZGsvaXNzdWVzLzEwMzQ3XG4gICAgICAgIGNvbnN0IGNsdXN0ZXJJZCA9IEZuLnNlbGVjdCg0LCBGbi5zcGxpdCgnLycsIGNsdXN0ZXIuY2x1c3Rlck9wZW5JZENvbm5lY3RJc3N1ZXJVcmwpKSAvLyBSZW1vdmUgaHR0cHM6Ly8gZnJvbSB0aGUgVVJMIGFzIHdvcmthcm91bmQgdG8gZ2V0IENsdXN0ZXJJRFxuXG4gICAgICAgIGNvbnN0IGN3X2ZlZGVyYXRlZFByaW5jaXBhbCA9IG5ldyBpYW0uRmVkZXJhdGVkUHJpbmNpcGFsKFxuICAgICAgICAgICAgY2x1c3Rlci5vcGVuSWRDb25uZWN0UHJvdmlkZXIub3BlbklkQ29ubmVjdFByb3ZpZGVyQXJuLFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIFN0cmluZ0VxdWFsczogbmV3IENmbkpzb24odGhpcywgXCJDV19GZWRlcmF0ZWRQcmluY2lwYWxDb25kaXRpb25cIiwge1xuICAgICAgICAgICAgICAgICAgICB2YWx1ZToge1xuICAgICAgICAgICAgICAgICAgICAgICAgW2BvaWRjLmVrcy4ke3JlZ2lvbn0uYW1hem9uYXdzLmNvbS9pZC8ke2NsdXN0ZXJJZH06YXVkYCBdOiBcInN0cy5hbWF6b25hd3MuY29tXCJcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICB9XG4gICAgICAgICk7XG4gICAgICAgIGNvbnN0IGN3X3RydXN0UmVsYXRpb25zaGlwID0gbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICAgICAgcHJpbmNpcGFsczogWyBjd19mZWRlcmF0ZWRQcmluY2lwYWwgXSxcbiAgICAgICAgICAgIGFjdGlvbnM6IFtcInN0czpBc3N1bWVSb2xlV2l0aFdlYklkZW50aXR5XCJdXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIENyZWF0ZSBJQU0gcm9sZXMgZm9yIFNlcnZpY2UgQWNjb3VudHNcbiAgICAgICAgLy8gQ2xvdWR3YXRjaCBBZ2VudCBTQVxuICAgICAgICBjb25zdCBjd3NlcnZpY2VhY2NvdW50ID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdDV1NlcnZpY2VBY2NvdW50Jywge1xuLy8gICAgICAgICAgICAgICAgYXNzdW1lZEJ5OiBla3NGZWRlcmF0ZWRQcmluY2lwYWwsXG4gICAgICAgICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uQWNjb3VudFJvb3RQcmluY2lwYWwoKSxcbiAgICAgICAgICAgIG1hbmFnZWRQb2xpY2llczogW1xuICAgICAgICAgICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21NYW5hZ2VkUG9saWN5QXJuKHRoaXMsICdDV1NlcnZpY2VBY2NvdW50LUNsb3VkV2F0Y2hBZ2VudFNlcnZlclBvbGljeScsICdhcm46YXdzOmlhbTo6YXdzOnBvbGljeS9DbG91ZFdhdGNoQWdlbnRTZXJ2ZXJQb2xpY3knKVxuICAgICAgICAgICAgXSxcbiAgICAgICAgfSk7XG4gICAgICAgIGN3c2VydmljZWFjY291bnQuYXNzdW1lUm9sZVBvbGljeT8uYWRkU3RhdGVtZW50cyhjd190cnVzdFJlbGF0aW9uc2hpcCk7XG5cbiAgICAgICAgY29uc3QgeHJheV9mZWRlcmF0ZWRQcmluY2lwYWwgPSBuZXcgaWFtLkZlZGVyYXRlZFByaW5jaXBhbChcbiAgICAgICAgICAgIGNsdXN0ZXIub3BlbklkQ29ubmVjdFByb3ZpZGVyLm9wZW5JZENvbm5lY3RQcm92aWRlckFybixcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBTdHJpbmdFcXVhbHM6IG5ldyBDZm5Kc29uKHRoaXMsIFwiWHJheV9GZWRlcmF0ZWRQcmluY2lwYWxDb25kaXRpb25cIiwge1xuICAgICAgICAgICAgICAgICAgICB2YWx1ZToge1xuICAgICAgICAgICAgICAgICAgICAgICAgW2BvaWRjLmVrcy4ke3JlZ2lvbn0uYW1hem9uYXdzLmNvbS9pZC8ke2NsdXN0ZXJJZH06YXVkYCBdOiBcInN0cy5hbWF6b25hd3MuY29tXCJcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICB9XG4gICAgICAgICk7XG4gICAgICAgIGNvbnN0IHhyYXlfdHJ1c3RSZWxhdGlvbnNoaXAgPSBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgICAgICBwcmluY2lwYWxzOiBbIHhyYXlfZmVkZXJhdGVkUHJpbmNpcGFsIF0sXG4gICAgICAgICAgICBhY3Rpb25zOiBbXCJzdHM6QXNzdW1lUm9sZVdpdGhXZWJJZGVudGl0eVwiXVxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBYLVJheSBBZ2VudCBTQVxuICAgICAgICBjb25zdCB4cmF5c2VydmljZWFjY291bnQgPSBuZXcgaWFtLlJvbGUodGhpcywgJ1hSYXlTZXJ2aWNlQWNjb3VudCcsIHtcbi8vICAgICAgICAgICAgICAgIGFzc3VtZWRCeTogZWtzRmVkZXJhdGVkUHJpbmNpcGFsLFxuICAgICAgICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLkFjY291bnRSb290UHJpbmNpcGFsKCksXG4gICAgICAgICAgICBtYW5hZ2VkUG9saWNpZXM6IFtcbiAgICAgICAgICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tTWFuYWdlZFBvbGljeUFybih0aGlzLCAnWFJheVNlcnZpY2VBY2NvdW50LUFXU1hSYXlEYWVtb25Xcml0ZUFjY2VzcycsICdhcm46YXdzOmlhbTo6YXdzOnBvbGljeS9BV1NYUmF5RGFlbW9uV3JpdGVBY2Nlc3MnKVxuICAgICAgICAgICAgXSxcbiAgICAgICAgfSk7XG4gICAgICAgIHhyYXlzZXJ2aWNlYWNjb3VudC5hc3N1bWVSb2xlUG9saWN5Py5hZGRTdGF0ZW1lbnRzKHhyYXlfdHJ1c3RSZWxhdGlvbnNoaXApO1xuXG4gICAgICAgIGNvbnN0IGxvYWRiYWxhbmNlcl9mZWRlcmF0ZWRQcmluY2lwYWwgPSBuZXcgaWFtLkZlZGVyYXRlZFByaW5jaXBhbChcbiAgICAgICAgICAgIGNsdXN0ZXIub3BlbklkQ29ubmVjdFByb3ZpZGVyLm9wZW5JZENvbm5lY3RQcm92aWRlckFybixcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBTdHJpbmdFcXVhbHM6IG5ldyBDZm5Kc29uKHRoaXMsIFwiTEJfRmVkZXJhdGVkUHJpbmNpcGFsQ29uZGl0aW9uXCIsIHtcbiAgICAgICAgICAgICAgICAgICAgdmFsdWU6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIFtgb2lkYy5la3MuJHtyZWdpb259LmFtYXpvbmF3cy5jb20vaWQvJHtjbHVzdGVySWR9OmF1ZGAgXTogXCJzdHMuYW1hem9uYXdzLmNvbVwiXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgfVxuICAgICAgICApO1xuICAgICAgICBjb25zdCBsb2FkQmFsYW5jZXJfdHJ1c3RSZWxhdGlvbnNoaXAgPSBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgICAgICBwcmluY2lwYWxzOiBbIGxvYWRiYWxhbmNlcl9mZWRlcmF0ZWRQcmluY2lwYWwgXSxcbiAgICAgICAgICAgIGFjdGlvbnM6IFtcInN0czpBc3N1bWVSb2xlV2l0aFdlYklkZW50aXR5XCJdXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IGxvYWRCYWxhbmNlclBvbGljeURvYyA9IGlhbS5Qb2xpY3lEb2N1bWVudC5mcm9tSnNvbihKU09OLnBhcnNlKHJlYWRGaWxlU3luYyhcIi4vcmVzb3VyY2VzL2xvYWRfYmFsYW5jZXIvaWFtX3BvbGljeS5qc29uXCIsXCJ1dGY4XCIpKSk7XG4gICAgICAgIGNvbnN0IGxvYWRCYWxhbmNlclBvbGljeSA9IG5ldyBpYW0uTWFuYWdlZFBvbGljeSh0aGlzLCdMb2FkQmFsYW5jZXJTQVBvbGljeScsIHsgZG9jdW1lbnQ6IGxvYWRCYWxhbmNlclBvbGljeURvYyB9KTtcbiAgICAgICAgY29uc3QgbG9hZEJhbGFuY2Vyc2VydmljZWFjY291bnQgPSBuZXcgaWFtLlJvbGUodGhpcywgJ0xvYWRCYWxhbmNlclNlcnZpY2VBY2NvdW50Jywge1xuLy8gICAgICAgICAgICAgICAgYXNzdW1lZEJ5OiBla3NGZWRlcmF0ZWRQcmluY2lwYWwsXG4gICAgICAgICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uQWNjb3VudFJvb3RQcmluY2lwYWwoKSxcbiAgICAgICAgICAgIG1hbmFnZWRQb2xpY2llczogW2xvYWRCYWxhbmNlclBvbGljeV1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgbG9hZEJhbGFuY2Vyc2VydmljZWFjY291bnQuYXNzdW1lUm9sZVBvbGljeT8uYWRkU3RhdGVtZW50cyhsb2FkQmFsYW5jZXJfdHJ1c3RSZWxhdGlvbnNoaXApO1xuXG4gICAgICAgIC8vIEZpeCBmb3IgRUtTIERhc2hib2FyZCBhY2Nlc3NcblxuICAgICAgICBjb25zdCBkYXNoYm9hcmRSb2xlWWFtbCA9IHlhbWwubG9hZEFsbChyZWFkRmlsZVN5bmMoXCIuL3Jlc291cmNlcy9kYXNoYm9hcmQueWFtbFwiLFwidXRmOFwiKSkgYXMgUmVjb3JkPHN0cmluZyxhbnk+W107XG5cbiAgICAgICAgY29uc3QgZGFzaGJvYXJkUm9sZUFybiA9IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdkYXNoYm9hcmRfcm9sZV9hcm4nKTtcbiAgICAgICAgaWYoKGRhc2hib2FyZFJvbGVBcm4gIT0gdW5kZWZpbmVkKSYmKGRhc2hib2FyZFJvbGVBcm4ubGVuZ3RoID4gMCkpIHtcbiAgICAgICAgICAgIGNvbnN0IHJvbGUgPSBpYW0uUm9sZS5mcm9tUm9sZUFybih0aGlzLCBcIkRhc2hib2FyZFJvbGVBcm5cIixkYXNoYm9hcmRSb2xlQXJuLHttdXRhYmxlOmZhbHNlfSk7XG4gICAgICAgICAgICBjbHVzdGVyLmF3c0F1dGguYWRkUm9sZU1hcHBpbmcocm9sZSx7Z3JvdXBzOltcImRhc2hib2FyZC12aWV3XCJdfSk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoaXNFdmVudEVuZ2luZSA9PT0gJ3RydWUnKVxuICAgICAgICB7XG5cbiAgICAgICAgICAgIHZhciBjOUVudiA9IG5ldyBDbG91ZDlFbnZpcm9ubWVudCh0aGlzLCAnQ2xvdWQ5RW52aXJvbm1lbnQnLCB7XG4gICAgICAgICAgICAgICAgdnBjSWQ6IHRoZVZQQy52cGNJZCxcbiAgICAgICAgICAgICAgICBzdWJuZXRJZDogdGhlVlBDLnB1YmxpY1N1Ym5ldHNbMF0uc3VibmV0SWQsXG4gICAgICAgICAgICAgICAgY2xvdWQ5T3duZXJBcm46IFwiYXNzdW1lZC1yb2xlL1dTUGFydGljaXBhbnRSb2xlL1BhcnRpY2lwYW50XCIsXG4gICAgICAgICAgICAgICAgdGVtcGxhdGVGaWxlOiBfX2Rpcm5hbWUgKyBcIi8uLi8uLi8uLi8uLi9jbG91ZDktY2ZuLnlhbWxcIlxuICAgICAgICAgICAgXG4gICAgICAgICAgICB9KTtcbiAgICBcbiAgICAgICAgICAgIHZhciBjOXJvbGUgPSBjOUVudi5jOVJvbGU7XG5cbiAgICAgICAgICAgIC8vIER5bmFtaWNhbGx5IGNoZWNrIGlmIEFXU0Nsb3VkOVNTTUFjY2Vzc1JvbGUgYW5kIEFXU0Nsb3VkOVNTTUluc3RhbmNlUHJvZmlsZSBleGlzdHNcbiAgICAgICAgICAgIGNvbnN0IGM5U1NNUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCdBV1NDbG91ZDlTU01BY2Nlc3NSb2xlJywge1xuICAgICAgICAgICAgICAgIHBhdGg6ICcvc2VydmljZS1yb2xlLycsXG4gICAgICAgICAgICAgICAgcm9sZU5hbWU6ICdBV1NDbG91ZDlTU01BY2Nlc3NSb2xlJyxcbiAgICAgICAgICAgICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uQ29tcG9zaXRlUHJpbmNpcGFsKG5ldyBpYW0uU2VydmljZVByaW5jaXBhbChcImVjMi5hbWF6b25hd3MuY29tXCIpLCBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoXCJjbG91ZDkuYW1hem9uYXdzLmNvbVwiKSksXG4gICAgICAgICAgICAgICAgbWFuYWdlZFBvbGljaWVzOiBbaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKFwiQVdTQ2xvdWQ5U1NNSW5zdGFuY2VQcm9maWxlXCIpLGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZShcIkFkbWluaXN0cmF0b3JBY2Nlc3NcIildXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY29uc3QgdGVhbVJvbGUgPSBpYW0uUm9sZS5mcm9tUm9sZUFybih0aGlzLCdUZWFtUm9sZScsXCJhcm46YXdzOmlhbTo6XCIgKyBzdGFjay5hY2NvdW50ICtcIjpyb2xlL1dTUGFydGljaXBhbnRSb2xlXCIpO1xuICAgICAgICAgICAgY2x1c3Rlci5hd3NBdXRoLmFkZFJvbGVNYXBwaW5nKHRlYW1Sb2xlLHtncm91cHM6W1wiZGFzaGJvYXJkLXZpZXdcIl19KTtcbiAgICAgICAgICAgIFxuXG4gICAgICAgICAgICBpZiAoYzlyb2xlIT11bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICBjbHVzdGVyLmF3c0F1dGguYWRkTWFzdGVyc1JvbGUoaWFtLlJvbGUuZnJvbVJvbGVBcm4odGhpcywgJ2M5cm9sZScsIGM5cm9sZS5hdHRyQXJuLCB7IG11dGFibGU6IGZhbHNlIH0pKTtcbiAgICAgICAgICAgIH1cblxuXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBla3NBZG1pbkFybiA9IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdhZG1pbl9yb2xlJyk7XG4gICAgICAgIGlmICgoZWtzQWRtaW5Bcm4hPXVuZGVmaW5lZCkmJihla3NBZG1pbkFybi5sZW5ndGggPiAwKSkge1xuICAgICAgICAgICAgY29uc3Qgcm9sZSA9IGlhbS5Sb2xlLmZyb21Sb2xlQXJuKHRoaXMsXCJla2RBZG1pblJvbGVBcm5cIixla3NBZG1pbkFybix7bXV0YWJsZTpmYWxzZX0pO1xuICAgICAgICAgICAgY2x1c3Rlci5hd3NBdXRoLmFkZE1hc3RlcnNSb2xlKHJvbGUpXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBkYWhzaGJvYXJkTWFuaWZlc3QgPSBuZXcgZWtzLkt1YmVybmV0ZXNNYW5pZmVzdCh0aGlzLFwiazhzZGFzaGJvYXJkcmJhY1wiLHtcbiAgICAgICAgICAgIGNsdXN0ZXI6IGNsdXN0ZXIsXG4gICAgICAgICAgICBtYW5pZmVzdDogZGFzaGJvYXJkUm9sZVlhbWxcbiAgICAgICAgfSk7XG5cblxuICAgICAgICB2YXIgeFJheVlhbWwgPSB5YW1sLmxvYWRBbGwocmVhZEZpbGVTeW5jKFwiLi9yZXNvdXJjZXMvazhzX3BldHNpdGUveHJheS1kYWVtb24tY29uZmlnLnlhbWxcIixcInV0ZjhcIikpIGFzIFJlY29yZDxzdHJpbmcsYW55PltdO1xuXG4gICAgICAgIHhSYXlZYW1sWzBdLm1ldGFkYXRhLmFubm90YXRpb25zW1wiZWtzLmFtYXpvbmF3cy5jb20vcm9sZS1hcm5cIl0gPSBuZXcgQ2ZuSnNvbih0aGlzLCBcInhyYXlfUm9sZVwiLCB7IHZhbHVlIDogYCR7eHJheXNlcnZpY2VhY2NvdW50LnJvbGVBcm59YCB9KTtcblxuICAgICAgICBjb25zdCB4cmF5TWFuaWZlc3QgPSBuZXcgZWtzLkt1YmVybmV0ZXNNYW5pZmVzdCh0aGlzLFwieHJheWRlcGxveW1lbnRcIix7XG4gICAgICAgICAgICBjbHVzdGVyOiBjbHVzdGVyLFxuICAgICAgICAgICAgbWFuaWZlc3Q6IHhSYXlZYW1sXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHZhciBsb2FkQmFsYW5jZXJTZXJ2aWNlQWNjb3VudFlhbWwgID0geWFtbC5sb2FkQWxsKHJlYWRGaWxlU3luYyhcIi4vcmVzb3VyY2VzL2xvYWRfYmFsYW5jZXIvc2VydmljZV9hY2NvdW50LnlhbWxcIixcInV0ZjhcIikpIGFzIFJlY29yZDxzdHJpbmcsYW55PltdO1xuICAgICAgICBsb2FkQmFsYW5jZXJTZXJ2aWNlQWNjb3VudFlhbWxbMF0ubWV0YWRhdGEuYW5ub3RhdGlvbnNbXCJla3MuYW1hem9uYXdzLmNvbS9yb2xlLWFyblwiXSA9IG5ldyBDZm5Kc29uKHRoaXMsIFwibG9hZEJhbGFuY2VyX1JvbGVcIiwgeyB2YWx1ZSA6IGAke2xvYWRCYWxhbmNlcnNlcnZpY2VhY2NvdW50LnJvbGVBcm59YCB9KTtcblxuICAgICAgICBjb25zdCBsb2FkQmFsYW5jZXJTZXJ2aWNlQWNjb3VudCA9IG5ldyBla3MuS3ViZXJuZXRlc01hbmlmZXN0KHRoaXMsIFwibG9hZEJhbGFuY2VyU2VydmljZUFjY291bnRcIix7XG4gICAgICAgICAgICBjbHVzdGVyOiBjbHVzdGVyLFxuICAgICAgICAgICAgbWFuaWZlc3Q6IGxvYWRCYWxhbmNlclNlcnZpY2VBY2NvdW50WWFtbFxuICAgICAgICB9KTtcblxuICAgICAgICBjb25zdCB3YWl0Rm9yTEJTZXJ2aWNlQWNjb3VudCA9IG5ldyBla3MuS3ViZXJuZXRlc09iamVjdFZhbHVlKHRoaXMsJ0xCU2VydmljZUFjY291bnQnLHtcbiAgICAgICAgICAgIGNsdXN0ZXI6IGNsdXN0ZXIsXG4gICAgICAgICAgICBvYmplY3ROYW1lOiBcImFsYi1pbmdyZXNzLWNvbnRyb2xsZXJcIixcbiAgICAgICAgICAgIG9iamVjdFR5cGU6IFwic2VydmljZWFjY291bnRcIixcbiAgICAgICAgICAgIG9iamVjdE5hbWVzcGFjZTogXCJrdWJlLXN5c3RlbVwiLFxuICAgICAgICAgICAganNvblBhdGg6IFwiQFwiXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IGxvYWRCYWxhbmNlckNSRFlhbWwgPSB5YW1sLmxvYWRBbGwocmVhZEZpbGVTeW5jKFwiLi9yZXNvdXJjZXMvbG9hZF9iYWxhbmNlci9jcmRzLnlhbWxcIixcInV0ZjhcIikpIGFzIFJlY29yZDxzdHJpbmcsYW55PltdO1xuICAgICAgICBjb25zdCBsb2FkQmFsYW5jZXJDUkRNYW5pZmVzdCA9IG5ldyBla3MuS3ViZXJuZXRlc01hbmlmZXN0KHRoaXMsXCJsb2FkQmFsYW5jZXJDUkRcIix7XG4gICAgICAgICAgICBjbHVzdGVyOiBjbHVzdGVyLFxuICAgICAgICAgICAgbWFuaWZlc3Q6IGxvYWRCYWxhbmNlckNSRFlhbWxcbiAgICAgICAgfSk7XG5cblxuICAgICAgICBjb25zdCBhd3NMb2FkQmFsYW5jZXJNYW5pZmVzdCA9IG5ldyBla3MuSGVsbUNoYXJ0KHRoaXMsIFwiQVdTTG9hZEJhbGFuY2VyQ29udHJvbGxlclwiLCB7XG4gICAgICAgICAgICBjbHVzdGVyOiBjbHVzdGVyLFxuICAgICAgICAgICAgY2hhcnQ6IFwiYXdzLWxvYWQtYmFsYW5jZXItY29udHJvbGxlclwiLFxuICAgICAgICAgICAgcmVwb3NpdG9yeTogXCJodHRwczovL2F3cy5naXRodWIuaW8vZWtzLWNoYXJ0c1wiLFxuICAgICAgICAgICAgbmFtZXNwYWNlOiBcImt1YmUtc3lzdGVtXCIsXG4gICAgICAgICAgICB2YWx1ZXM6IHtcbiAgICAgICAgICAgIGNsdXN0ZXJOYW1lOlwiUGV0U2l0ZVwiLFxuICAgICAgICAgICAgc2VydmljZUFjY291bnQ6e1xuICAgICAgICAgICAgICAgIGNyZWF0ZTogZmFsc2UsXG4gICAgICAgICAgICAgICAgbmFtZTogXCJhbGItaW5ncmVzcy1jb250cm9sbGVyXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB3YWl0OiB0cnVlXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBhd3NMb2FkQmFsYW5jZXJNYW5pZmVzdC5ub2RlLmFkZERlcGVuZGVuY3kobG9hZEJhbGFuY2VyQ1JETWFuaWZlc3QpO1xuICAgICAgICBhd3NMb2FkQmFsYW5jZXJNYW5pZmVzdC5ub2RlLmFkZERlcGVuZGVuY3kobG9hZEJhbGFuY2VyU2VydmljZUFjY291bnQpO1xuICAgICAgICBhd3NMb2FkQmFsYW5jZXJNYW5pZmVzdC5ub2RlLmFkZERlcGVuZGVuY3kod2FpdEZvckxCU2VydmljZUFjY291bnQpO1xuXG4gICAgICAgIC8vIE5PVEU6IGFtYXpvbi1jbG91ZHdhdGNoIG5hbWVzcGFjZSBpcyBjcmVhdGVkIGhlcmUhIVxuICAgICAgICAvLyB2YXIgZmx1ZW50Yml0WWFtbCA9IHlhbWwubG9hZEFsbChyZWFkRmlsZVN5bmMoXCIuL3Jlc291cmNlcy9jd2FnZW50LWZsdWVudC1iaXQtcXVpY2tzdGFydC55YW1sXCIsXCJ1dGY4XCIpKSBhcyBSZWNvcmQ8c3RyaW5nLGFueT5bXTtcbiAgICAgICAgLy8gZmx1ZW50Yml0WWFtbFsxXS5tZXRhZGF0YS5hbm5vdGF0aW9uc1tcImVrcy5hbWF6b25hd3MuY29tL3JvbGUtYXJuXCJdID0gbmV3IENmbkpzb24odGhpcywgXCJmbHVlbnRiaXRfUm9sZVwiLCB7IHZhbHVlIDogYCR7Y3dzZXJ2aWNlYWNjb3VudC5yb2xlQXJufWAgfSk7XG5cbiAgICAgICAgLy8gZmx1ZW50Yml0WWFtbFs0XS5kYXRhW1wiY3dhZ2VudGNvbmZpZy5qc29uXCJdID0gSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAvLyAgICAgYWdlbnQ6IHtcbiAgICAgICAgLy8gICAgICAgICByZWdpb246IHJlZ2lvbiAgfSxcbiAgICAgICAgLy8gICAgIGxvZ3M6IHtcbiAgICAgICAgLy8gICAgICAgICBtZXRyaWNzX2NvbGxlY3RlZDoge1xuICAgICAgICAvLyAgICAgICAgICAgICBrdWJlcm5ldGVzOiB7XG4gICAgICAgIC8vICAgICAgICAgICAgICAgICBjbHVzdGVyX25hbWU6IFwiUGV0U2l0ZVwiLFxuICAgICAgICAvLyAgICAgICAgICAgICAgICAgbWV0cmljc19jb2xsZWN0aW9uX2ludGVydmFsOiA2MFxuICAgICAgICAvLyAgICAgICAgICAgICB9XG4gICAgICAgIC8vICAgICAgICAgfSxcbiAgICAgICAgLy8gICAgICAgICBmb3JjZV9mbHVzaF9pbnRlcnZhbDogNVxuXG4gICAgICAgIC8vICAgICAgICAgfVxuXG4gICAgICAgIC8vICAgICB9KTtcblxuICAgICAgICAvLyBmbHVlbnRiaXRZYW1sWzZdLmRhdGFbXCJjbHVzdGVyLm5hbWVcIl0gPSBcIlBldFNpdGVcIjtcbiAgICAgICAgLy8gZmx1ZW50Yml0WWFtbFs2XS5kYXRhW1wibG9ncy5yZWdpb25cIl0gPSByZWdpb247XG4gICAgICAgIC8vIGZsdWVudGJpdFlhbWxbN10ubWV0YWRhdGEuYW5ub3RhdGlvbnNbXCJla3MuYW1hem9uYXdzLmNvbS9yb2xlLWFyblwiXSA9IG5ldyBDZm5Kc29uKHRoaXMsIFwiY2xvdWR3YXRjaF9Sb2xlXCIsIHsgdmFsdWUgOiBgJHtjd3NlcnZpY2VhY2NvdW50LnJvbGVBcm59YCB9KTtcbiAgICAgICAgXG4gICAgICAgIC8vIC8vIFRoZSBgY2x1c3Rlci1pbmZvYCBjb25maWdtYXAgaXMgdXNlZCBieSB0aGUgY3VycmVudCBQeXRob24gaW1wbGVtZW50YXRpb24gZm9yIHRoZSBgQXdzRWtzUmVzb3VyY2VEZXRlY3RvcmBcbiAgICAgICAgLy8gZmx1ZW50Yml0WWFtbFsxMl0uZGF0YVtcImNsdXN0ZXIubmFtZVwiXSA9IFwiUGV0U2l0ZVwiO1xuICAgICAgICAvLyBmbHVlbnRiaXRZYW1sWzEyXS5kYXRhW1wibG9ncy5yZWdpb25cIl0gPSByZWdpb247XG5cbiAgICAgICAgLy8gY29uc3QgZmx1ZW50Yml0TWFuaWZlc3QgPSBuZXcgZWtzLkt1YmVybmV0ZXNNYW5pZmVzdCh0aGlzLFwiY2xvdWR3YXRjaGVwbG95bWVudFwiLHtcbiAgICAgICAgLy8gICAgIGNsdXN0ZXI6IGNsdXN0ZXIsXG4gICAgICAgIC8vICAgICBtYW5pZmVzdDogZmx1ZW50Yml0WWFtbFxuICAgICAgICAvLyB9KTtcblxuICAgICAgICAvLyBDbG91ZFdhdGNoIGFnZW50IGZvciBwcm9tZXRoZXVzIG1ldHJpY3NcbiAgICAgICAgLy8gdmFyIHByb21ldGhldXNZYW1sID0geWFtbC5sb2FkQWxsKHJlYWRGaWxlU3luYyhcIi4vcmVzb3VyY2VzL3Byb21ldGhldXMtZWtzLnlhbWxcIixcInV0ZjhcIikpIGFzIFJlY29yZDxzdHJpbmcsYW55PltdO1xuXG4gICAgICAgIC8vIHByb21ldGhldXNZYW1sWzFdLm1ldGFkYXRhLmFubm90YXRpb25zW1wiZWtzLmFtYXpvbmF3cy5jb20vcm9sZS1hcm5cIl0gPSBuZXcgQ2ZuSnNvbih0aGlzLCBcInByb21ldGhldXNfUm9sZVwiLCB7IHZhbHVlIDogYCR7Y3dzZXJ2aWNlYWNjb3VudC5yb2xlQXJufWAgfSk7XG5cbiAgICAgICAgLy8gY29uc3QgcHJvbWV0aGV1c01hbmlmZXN0ID0gbmV3IGVrcy5LdWJlcm5ldGVzTWFuaWZlc3QodGhpcyxcInByb21ldGhldXNkZXBsb3ltZW50XCIse1xuICAgICAgICAvLyAgICAgY2x1c3RlcjogY2x1c3RlcixcbiAgICAgICAgLy8gICAgIG1hbmlmZXN0OiBwcm9tZXRoZXVzWWFtbFxuICAgICAgICAvLyB9KTtcblxuICAgICAgICAvLyBwcm9tZXRoZXVzTWFuaWZlc3Qubm9kZS5hZGREZXBlbmRlbmN5KGZsdWVudGJpdE1hbmlmZXN0KTsgLy8gTmFtZXNwYWNlIGNyZWF0aW9uIGRlcGVuZGVuY3lcblxuICAgICAgICBcbnZhciBkYXNoYm9hcmRCb2R5ID0gcmVhZEZpbGVTeW5jKFwiLi9yZXNvdXJjZXMvY3dfZGFzaGJvYXJkX2ZsdWVudF9iaXQuanNvblwiLFwidXRmLThcIik7XG4gICAgICAgIGRhc2hib2FyZEJvZHkgPSBkYXNoYm9hcmRCb2R5LnJlcGxhY2VBbGwoXCJ7e1lPVVJfQ0xVU1RFUl9OQU1FfX1cIixcIlBldFNpdGVcIik7XG4gICAgICAgIGRhc2hib2FyZEJvZHkgPSBkYXNoYm9hcmRCb2R5LnJlcGxhY2VBbGwoXCJ7e1lPVVJfQVdTX1JFR0lPTn19XCIscmVnaW9uKTtcblxuICAgICAgICBjb25zdCBmbHVlbnRCaXREYXNoYm9hcmQgPSBuZXcgY2xvdWR3YXRjaC5DZm5EYXNoYm9hcmQodGhpcywgXCJGbHVlbnRCaXREYXNoYm9hcmRcIiwge1xuICAgICAgICAgICAgZGFzaGJvYXJkTmFtZTogXCJFS1NfRmx1ZW50Qml0X0Rhc2hib2FyZFwiLFxuICAgICAgICAgICAgZGFzaGJvYXJkQm9keTogZGFzaGJvYXJkQm9keVxuICAgICAgICB9KTtcblxuICAgICAgICBjb25zdCBjdXN0b21XaWRnZXRSZXNvdXJjZUNvbnRyb2xsZXJQb2xpY3kgPSBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAgICAgJ2VjczpMaXN0U2VydmljZXMnLFxuICAgICAgICAgICAgICAgICdlY3M6VXBkYXRlU2VydmljZScsXG4gICAgICAgICAgICAgICAgJ2VrczpEZXNjcmliZU5vZGVncm91cCcsXG4gICAgICAgICAgICAgICAgJ2VrczpMaXN0Tm9kZWdyb3VwcycsXG4gICAgICAgICAgICAgICAgJ2VrczpEZXNjcmliZVVwZGF0ZScsXG4gICAgICAgICAgICAgICAgJ2VrczpVcGRhdGVOb2RlZ3JvdXBDb25maWcnLFxuICAgICAgICAgICAgICAgICdlY3M6RGVzY3JpYmVTZXJ2aWNlcycsXG4gICAgICAgICAgICAgICAgJ2VrczpEZXNjcmliZUNsdXN0ZXInLFxuICAgICAgICAgICAgICAgICdla3M6TGlzdENsdXN0ZXJzJyxcbiAgICAgICAgICAgICAgICAnZWNzOkxpc3RDbHVzdGVycydcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICByZXNvdXJjZXM6IFsnKiddXG4gICAgICAgIH0pO1xuICAgICAgICB2YXIgY3VzdG9tV2lkZ2V0TGFtYmRhUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnY3VzdG9tV2lkZ2V0TGFtYmRhUm9sZScsIHtcbiAgICAgICAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLFxuICAgICAgICB9KTtcbiAgICAgICAgY3VzdG9tV2lkZ2V0TGFtYmRhUm9sZS5hZGRUb1ByaW5jaXBhbFBvbGljeShjdXN0b21XaWRnZXRSZXNvdXJjZUNvbnRyb2xsZXJQb2xpY3kpO1xuXG4gICAgICAgIHZhciBwZXRzaXRlQXBwbGljYXRpb25SZXNvdXJjZUNvbnRyb2xsZXIgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdwZXRzaXRlLWFwcGxpY2F0aW9uLXJlc291cmNlLWNvbnRyb2xlcicsIHtcbiAgICAgICAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLy4uL3Jlc291cmNlcy9yZXNvdXJjZS1jb250cm9sbGVyLXdpZGdldCcpKSxcbiAgICAgICAgICAgIGhhbmRsZXI6ICdwZXRzaXRlLWFwcGxpY2F0aW9uLXJlc291cmNlLWNvbnRyb2xlci5sYW1iZGFfaGFuZGxlcicsXG4gICAgICAgICAgICBtZW1vcnlTaXplOiAxMjgsXG4gICAgICAgICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5QWVRIT05fM185LFxuICAgICAgICAgICAgcm9sZTogY3VzdG9tV2lkZ2V0TGFtYmRhUm9sZSxcbiAgICAgICAgICAgIHRpbWVvdXQ6IER1cmF0aW9uLm1pbnV0ZXMoMTApXG4gICAgICAgIH0pO1xuICAgICAgICBwZXRzaXRlQXBwbGljYXRpb25SZXNvdXJjZUNvbnRyb2xsZXIuYWRkRW52aXJvbm1lbnQoXCJFS1NfQ0xVU1RFUl9OQU1FXCIsIGNsdXN0ZXIuY2x1c3Rlck5hbWUpO1xuICAgICAgICBwZXRzaXRlQXBwbGljYXRpb25SZXNvdXJjZUNvbnRyb2xsZXIuYWRkRW52aXJvbm1lbnQoXCJFQ1NfQ0xVU1RFUl9BUk5TXCIsIGVjc1BheUZvckFkb3B0aW9uQ2x1c3Rlci5jbHVzdGVyQXJuICsgXCIsXCIgK1xuICAgICAgICAgICAgZWNzUGV0TGlzdEFkb3B0aW9uQ2x1c3Rlci5jbHVzdGVyQXJuICsgXCIsXCIgKyBlY3NQZXRTZWFyY2hDbHVzdGVyLmNsdXN0ZXJBcm4pO1xuXG4gICAgICAgIHZhciBjdXN0b21XaWRnZXRGdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ2Nsb3Vkd2F0Y2gtY3VzdG9tLXdpZGdldCcsIHtcbiAgICAgICAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLy4uL3Jlc291cmNlcy9yZXNvdXJjZS1jb250cm9sbGVyLXdpZGdldCcpKSxcbiAgICAgICAgICAgIGhhbmRsZXI6ICdjbG91ZHdhdGNoLWN1c3RvbS13aWRnZXQubGFtYmRhX2hhbmRsZXInLFxuICAgICAgICAgICAgbWVtb3J5U2l6ZTogMTI4LFxuICAgICAgICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuUFlUSE9OXzNfOSxcbiAgICAgICAgICAgIHJvbGU6IGN1c3RvbVdpZGdldExhbWJkYVJvbGUsXG4gICAgICAgICAgICB0aW1lb3V0OiBEdXJhdGlvbi5zZWNvbmRzKDYwKVxuICAgICAgICB9KTtcbiAgICAgICAgY3VzdG9tV2lkZ2V0RnVuY3Rpb24uYWRkRW52aXJvbm1lbnQoXCJDT05UUk9MRVJfTEFNQkRBX0FSTlwiLCBwZXRzaXRlQXBwbGljYXRpb25SZXNvdXJjZUNvbnRyb2xsZXIuZnVuY3Rpb25Bcm4pO1xuICAgICAgICBjdXN0b21XaWRnZXRGdW5jdGlvbi5hZGRFbnZpcm9ubWVudChcIkVLU19DTFVTVEVSX05BTUVcIiwgY2x1c3Rlci5jbHVzdGVyTmFtZSk7XG4gICAgICAgIGN1c3RvbVdpZGdldEZ1bmN0aW9uLmFkZEVudmlyb25tZW50KFwiRUNTX0NMVVNURVJfQVJOU1wiLCBlY3NQYXlGb3JBZG9wdGlvbkNsdXN0ZXIuY2x1c3RlckFybiArIFwiLFwiICtcbiAgICAgICAgICAgIGVjc1BldExpc3RBZG9wdGlvbkNsdXN0ZXIuY2x1c3RlckFybiArIFwiLFwiICsgZWNzUGV0U2VhcmNoQ2x1c3Rlci5jbHVzdGVyQXJuKTtcblxuICAgICAgICB2YXIgY29zdENvbnRyb2xEYXNoYm9hcmRCb2R5ID0gcmVhZEZpbGVTeW5jKFwiLi9yZXNvdXJjZXMvY3dfZGFzaGJvYXJkX2Nvc3RfY29udHJvbC5qc29uXCIsXCJ1dGYtOFwiKTtcbiAgICAgICAgY29zdENvbnRyb2xEYXNoYm9hcmRCb2R5ID0gY29zdENvbnRyb2xEYXNoYm9hcmRCb2R5LnJlcGxhY2VBbGwoXCJ7e1lPVVJfTEFNQkRBX0FSTn19XCIsY3VzdG9tV2lkZ2V0RnVuY3Rpb24uZnVuY3Rpb25Bcm4pO1xuXG4gICAgICAgIGNvbnN0IHBldFNpdGVDb3N0Q29udHJvbERhc2hib2FyZCA9IG5ldyBjbG91ZHdhdGNoLkNmbkRhc2hib2FyZCh0aGlzLCBcIlBldFNpdGVDb3N0Q29udHJvbERhc2hib2FyZFwiLCB7XG4gICAgICAgICAgICBkYXNoYm9hcmROYW1lOiBcIlBldFNpdGVfQ29zdF9Db250cm9sX0Rhc2hib2FyZFwiLFxuICAgICAgICAgICAgZGFzaGJvYXJkQm9keTogY29zdENvbnRyb2xEYXNoYm9hcmRCb2R5XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIENyZWF0aW5nIEFXUyBSZXNvdXJjZSBHcm91cCBmb3IgYWxsIHRoZSByZXNvdXJjZXMgb2Ygc3RhY2suXG4gICAgICAgIGNvbnN0IHNlcnZpY2VzQ2ZuR3JvdXAgPSBuZXcgcmVzb3VyY2Vncm91cHMuQ2ZuR3JvdXAodGhpcywgJ1NlcnZpY2VzQ2ZuR3JvdXAnLCB7XG4gICAgICAgICAgICBuYW1lOiBzdGFja05hbWUsXG4gICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0NvbnRhaW5zIGFsbCB0aGUgcmVzb3VyY2VzIGRlcGxveWVkIGJ5IENsb3VkZm9ybWF0aW9uIFN0YWNrICcgKyBzdGFja05hbWUsXG4gICAgICAgICAgICByZXNvdXJjZVF1ZXJ5OiB7XG4gICAgICAgICAgICAgICAgdHlwZTogJ0NMT1VERk9STUFUSU9OX1NUQUNLXzFfMCcsXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIC8vIEVuYWJsaW5nIENsb3VkV2F0Y2ggQXBwbGljYXRpb24gSW5zaWdodHMgZm9yIFJlc291cmNlIEdyb3VwXG4gICAgICAgIGNvbnN0IHNlcnZpY2VzQ2ZuQXBwbGljYXRpb24gPSBuZXcgYXBwbGljYXRpb25pbnNpZ2h0cy5DZm5BcHBsaWNhdGlvbih0aGlzLCAnU2VydmljZXNBcHBsaWNhdGlvbkluc2lnaHRzJywge1xuICAgICAgICAgICAgcmVzb3VyY2VHcm91cE5hbWU6IHNlcnZpY2VzQ2ZuR3JvdXAubmFtZSxcbiAgICAgICAgICAgIGF1dG9Db25maWd1cmF0aW9uRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgIGN3ZU1vbml0b3JFbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgb3BzQ2VudGVyRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgfSk7XG4gICAgICAgIC8vIEFkZGluZyBkZXBlbmRlbmN5IHRvIGNyZWF0ZSB0aGVzZSByZXNvdXJjZXMgYXQgbGFzdFxuICAgICAgICBzZXJ2aWNlc0Nmbkdyb3VwLm5vZGUuYWRkRGVwZW5kZW5jeShwZXRTaXRlQ29zdENvbnRyb2xEYXNoYm9hcmQpO1xuICAgICAgICBzZXJ2aWNlc0NmbkFwcGxpY2F0aW9uLm5vZGUuYWRkRGVwZW5kZW5jeShzZXJ2aWNlc0Nmbkdyb3VwKTtcbiAgICAgICAgLy8gQWRkaW5nIGEgTGFtYmRhIGZ1bmN0aW9uIHRvIHByb2R1Y2UgdGhlIGVycm9ycyAtIG1hbnVhbGx5IGV4ZWN1dGVkXG4gICAgICAgIHZhciBkeW5hbW9kYlF1ZXJ5TGFtYmRhUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnZHluYW1vZGJRdWVyeUxhbWJkYVJvbGUnLCB7XG4gICAgICAgICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnbGFtYmRhLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgICAgICAgIG1hbmFnZWRQb2xpY2llczogW1xuICAgICAgICAgICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21NYW5hZ2VkUG9saWN5QXJuKHRoaXMsICdtYW5hZ2VkZHluYW1vZGJyZWFkJywgJ2Fybjphd3M6aWFtOjphd3M6cG9saWN5L0FtYXpvbkR5bmFtb0RCUmVhZE9ubHlBY2Nlc3MnKSxcbiAgICAgICAgICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tTWFuYWdlZFBvbGljeUFybih0aGlzLCAnbGFtYmRhQmFzaWNFeGVjUm9sZXRvZGRiJywgJ2Fybjphd3M6aWFtOjphd3M6cG9saWN5L3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUnKVxuICAgICAgICAgICAgXVxuICAgICAgICB9KTtcblxuICAgICAgICB2YXIgZHluYW1vZGJRdWVyeUZ1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnZHluYW1vZGItcXVlcnktZnVuY3Rpb24nLCB7XG4gICAgICAgICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQocGF0aC5qb2luKF9fZGlybmFtZSwgJy8uLi9yZXNvdXJjZXMvYXBwbGljYXRpb24taW5zaWdodHMnKSksXG4gICAgICAgICAgICBoYW5kbGVyOiAnZHluYW1vZGItcXVlcnktZnVuY3Rpb24ubGFtYmRhX2hhbmRsZXInLFxuICAgICAgICAgICAgbWVtb3J5U2l6ZTogMTI4LFxuICAgICAgICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuUFlUSE9OXzNfOSxcbiAgICAgICAgICAgIHJvbGU6IGR5bmFtb2RiUXVlcnlMYW1iZGFSb2xlLFxuICAgICAgICAgICAgdGltZW91dDogRHVyYXRpb24uc2Vjb25kcyg5MDApXG4gICAgICAgIH0pO1xuICAgICAgICBkeW5hbW9kYlF1ZXJ5RnVuY3Rpb24uYWRkRW52aXJvbm1lbnQoXCJEWU5BTU9EQl9UQUJMRV9OQU1FXCIsIGR5bmFtb2RiX3BldGFkb3B0aW9uLnRhYmxlTmFtZSk7XG5cbiAgICAgICAgdGhpcy5jcmVhdGVPdXB1dHMobmV3IE1hcChPYmplY3QuZW50cmllcyh7XG4gICAgICAgICAgICAnQ1dTZXJ2aWNlQWNjb3VudEFybic6IGN3c2VydmljZWFjY291bnQucm9sZUFybixcbiAgICAgICAgICAgICdYUmF5U2VydmljZUFjY291bnRBcm4nOiB4cmF5c2VydmljZWFjY291bnQucm9sZUFybixcbiAgICAgICAgICAgICdPSURDUHJvdmlkZXJVcmwnOiBjbHVzdGVyLmNsdXN0ZXJPcGVuSWRDb25uZWN0SXNzdWVyVXJsLFxuICAgICAgICAgICAgJ09JRENQcm92aWRlckFybic6IGNsdXN0ZXIub3BlbklkQ29ubmVjdFByb3ZpZGVyLm9wZW5JZENvbm5lY3RQcm92aWRlckFybixcbiAgICAgICAgICAgICdQZXRTaXRlVXJsJzogYGh0dHA6Ly8ke2FsYi5sb2FkQmFsYW5jZXJEbnNOYW1lfWAsXG4gICAgICAgICAgICAnRHluYW1vREJRdWVyeUZ1bmN0aW9uJzogZHluYW1vZGJRdWVyeUZ1bmN0aW9uLmZ1bmN0aW9uTmFtZVxuICAgICAgICB9KSkpO1xuXG5cbiAgICAgICAgY29uc3QgcGV0QWRvcHRpb25zU3RlcEZuID0gbmV3IFBldEFkb3B0aW9uc1N0ZXBGbih0aGlzLCdTdGVwRm4nKTtcblxuICAgICAgICB0aGlzLmNyZWF0ZVNzbVBhcmFtZXRlcnMobmV3IE1hcChPYmplY3QuZW50cmllcyh7XG4gICAgICAgICAgICAnL3BldHN0b3JlL3RyYWZmaWNkZWxheXRpbWUnOlwiNjBcIixcbiAgICAgICAgICAgICcvcGV0c3RvcmUvcnVtc2NyaXB0JzogXCIgXCIsXG4gICAgICAgICAgICAnL3BldHN0b3JlL3BldGFkb3B0aW9uc3N0ZXBmbmFybic6IHBldEFkb3B0aW9uc1N0ZXBGbi5zdGVwRm4uc3RhdGVNYWNoaW5lQXJuLFxuICAgICAgICAgICAgJy9wZXRzdG9yZS91cGRhdGVhZG9wdGlvbnN0YXR1c3VybCc6IHN0YXR1c1VwZGF0ZXJTZXJ2aWNlLmFwaS51cmwsXG4gICAgICAgICAgICAnL3BldHN0b3JlL3F1ZXVldXJsJzogc3FzUXVldWUucXVldWVVcmwsXG4gICAgICAgICAgICAnL3BldHN0b3JlL3Nuc2Fybic6IHRvcGljX3BldGFkb3B0aW9uLnRvcGljQXJuLFxuICAgICAgICAgICAgJy9wZXRzdG9yZS9keW5hbW9kYnRhYmxlbmFtZSc6IGR5bmFtb2RiX3BldGFkb3B0aW9uLnRhYmxlTmFtZSxcbiAgICAgICAgICAgICcvcGV0c3RvcmUvczNidWNrZXRuYW1lJzogczNfb2JzZXJ2YWJpbGl0eXBldGFkb3B0aW9ucy5idWNrZXROYW1lLFxuICAgICAgICAgICAgJy9wZXRzdG9yZS9zZWFyY2hhcGl1cmwnOiBgaHR0cDovLyR7c2VhcmNoU2VydmljZS5zZXJ2aWNlLmxvYWRCYWxhbmNlci5sb2FkQmFsYW5jZXJEbnNOYW1lfS9hcGkvc2VhcmNoP2AsXG4gICAgICAgICAgICAnL3BldHN0b3JlL3NlYXJjaGltYWdlJzogc2VhcmNoU2VydmljZS5jb250YWluZXIuaW1hZ2VOYW1lLFxuICAgICAgICAgICAgJy9wZXRzdG9yZS9wZXRsaXN0YWRvcHRpb25zdXJsJzogYGh0dHA6Ly8ke2xpc3RBZG9wdGlvbnNTZXJ2aWNlLnNlcnZpY2UubG9hZEJhbGFuY2VyLmxvYWRCYWxhbmNlckRuc05hbWV9L2FwaS9hZG9wdGlvbmxpc3QvYCxcbiAgICAgICAgICAgICcvcGV0c3RvcmUvcGV0bGlzdGFkb3B0aW9uc21ldHJpY3N1cmwnOiBgaHR0cDovLyR7bGlzdEFkb3B0aW9uc1NlcnZpY2Uuc2VydmljZS5sb2FkQmFsYW5jZXIubG9hZEJhbGFuY2VyRG5zTmFtZX0vbWV0cmljc2AsXG4gICAgICAgICAgICAnL3BldHN0b3JlL3BheW1lbnRhcGl1cmwnOiBgaHR0cDovLyR7cGF5Rm9yQWRvcHRpb25TZXJ2aWNlLnNlcnZpY2UubG9hZEJhbGFuY2VyLmxvYWRCYWxhbmNlckRuc05hbWV9L2FwaS9ob21lL2NvbXBsZXRlYWRvcHRpb25gLFxuICAgICAgICAgICAgJy9wZXRzdG9yZS9wYXlmb3JhZG9wdGlvbm1ldHJpY3N1cmwnOiBgaHR0cDovLyR7cGF5Rm9yQWRvcHRpb25TZXJ2aWNlLnNlcnZpY2UubG9hZEJhbGFuY2VyLmxvYWRCYWxhbmNlckRuc05hbWV9L21ldHJpY3NgLFxuICAgICAgICAgICAgJy9wZXRzdG9yZS9jbGVhbnVwYWRvcHRpb25zdXJsJzogYGh0dHA6Ly8ke3BheUZvckFkb3B0aW9uU2VydmljZS5zZXJ2aWNlLmxvYWRCYWxhbmNlci5sb2FkQmFsYW5jZXJEbnNOYW1lfS9hcGkvaG9tZS9jbGVhbnVwYWRvcHRpb25zYCxcbiAgICAgICAgICAgICcvcGV0c3RvcmUvcGV0c2VhcmNoLWNvbGxlY3Rvci1tYW51YWwtY29uZmlnJzogcmVhZEZpbGVTeW5jKFwiLi9yZXNvdXJjZXMvY29sbGVjdG9yL2Vjcy14cmF5LW1hbnVhbC55YW1sXCIsIFwidXRmOFwiKSxcbiAgICAgICAgICAgICcvcGV0c3RvcmUvcmRzc2VjcmV0YXJuJzogYCR7YXVyb3JhQ2x1c3Rlci5zZWNyZXQ/LnNlY3JldEFybn1gLFxuICAgICAgICAgICAgJy9wZXRzdG9yZS9yZHNlbmRwb2ludCc6IGF1cm9yYUNsdXN0ZXIuY2x1c3RlckVuZHBvaW50Lmhvc3RuYW1lLFxuICAgICAgICAgICAgJy9wZXRzdG9yZS9zdGFja25hbWUnOiBzdGFja05hbWUsXG4gICAgICAgICAgICAnL3BldHN0b3JlL3BldHNpdGV1cmwnOiBgaHR0cDovLyR7YWxiLmxvYWRCYWxhbmNlckRuc05hbWV9YCxcbiAgICAgICAgICAgICcvcGV0c3RvcmUvcGV0aGlzdG9yeXVybCc6IGBodHRwOi8vJHthbGIubG9hZEJhbGFuY2VyRG5zTmFtZX0vcGV0YWRvcHRpb25zaGlzdG9yeWAsXG4gICAgICAgICAgICAnL2Vrcy9wZXRzaXRlL09JRENQcm92aWRlclVybCc6IGNsdXN0ZXIuY2x1c3Rlck9wZW5JZENvbm5lY3RJc3N1ZXJVcmwsXG4gICAgICAgICAgICAnL2Vrcy9wZXRzaXRlL09JRENQcm92aWRlckFybic6IGNsdXN0ZXIub3BlbklkQ29ubmVjdFByb3ZpZGVyLm9wZW5JZENvbm5lY3RQcm92aWRlckFybixcbiAgICAgICAgICAgICcvcGV0c3RvcmUvZXJyb3Jtb2RlMSc6XCJmYWxzZVwiXG4gICAgICAgIH0pKSk7XG5cbiAgICAgICAgdGhpcy5jcmVhdGVPdXB1dHMobmV3IE1hcChPYmplY3QuZW50cmllcyh7XG4gICAgICAgICAgICAnUXVldWVVUkwnOiBzcXNRdWV1ZS5xdWV1ZVVybCxcbiAgICAgICAgICAgICdVcGRhdGVBZG9wdGlvblN0YXR1c3VybCc6IHN0YXR1c1VwZGF0ZXJTZXJ2aWNlLmFwaS51cmwsXG4gICAgICAgICAgICAnU05TVG9waWNBUk4nOiB0b3BpY19wZXRhZG9wdGlvbi50b3BpY0FybixcbiAgICAgICAgICAgICdSRFNTZXJ2ZXJOYW1lJzogYXVyb3JhQ2x1c3Rlci5jbHVzdGVyRW5kcG9pbnQuaG9zdG5hbWVcbiAgICAgICAgfSkpKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGNyZWF0ZVNzbVBhcmFtZXRlcnMocGFyYW1zOiBNYXA8c3RyaW5nLCBzdHJpbmc+KSB7XG4gICAgICAgIHBhcmFtcy5mb3JFYWNoKCh2YWx1ZSwga2V5KSA9PiB7XG4gICAgICAgICAgICAvL2NvbnN0IGlkID0ga2V5LnJlcGxhY2UoJy8nLCAnXycpO1xuICAgICAgICAgICAgbmV3IHNzbS5TdHJpbmdQYXJhbWV0ZXIodGhpcywga2V5LCB7IHBhcmFtZXRlck5hbWU6IGtleSwgc3RyaW5nVmFsdWU6IHZhbHVlIH0pO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGNyZWF0ZU91cHV0cyhwYXJhbXM6IE1hcDxzdHJpbmcsIHN0cmluZz4pIHtcbiAgICAgICAgcGFyYW1zLmZvckVhY2goKHZhbHVlLCBrZXkpID0+IHtcbiAgICAgICAgICAgIG5ldyBDZm5PdXRwdXQodGhpcywga2V5LCB7IHZhbHVlOiB2YWx1ZSB9KVxuICAgICAgICB9KTtcbiAgICB9XG59XG4iXX0=