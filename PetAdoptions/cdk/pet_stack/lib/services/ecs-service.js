"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EcsService = void 0;
const aws_cdk_lib_1 = require("aws-cdk-lib");
const iam = require("aws-cdk-lib/aws-iam");
const ecs = require("aws-cdk-lib/aws-ecs");
const logs = require("aws-cdk-lib/aws-logs");
const ecs_patterns = require("aws-cdk-lib/aws-ecs-patterns");
const constructs_1 = require("constructs");
class EcsService extends constructs_1.Construct {
    constructor(scope, id, props) {
        var _a, _b;
        super(scope, id);
        const logging = new ecs.AwsLogDriver({
            streamPrefix: "logs",
            logGroup: new logs.LogGroup(this, "ecs-log-group", {
                logGroupName: props.logGroupName,
                removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY
            })
        });
        /*
        const firelenslogging = new ecs.FireLensLogDriver({
          options: {
            "Name": "cloudwatch",
            "region": props.region,
            "log_key": "log",
            "log_group_name": props.logGroupName,
            "auto_create_group": "false",
            "log_stream_name": "$(ecs_task_id)"
          }
        });
       //*/
        const taskRole = new iam.Role(this, `taskRole`, {
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com')
        });
        this.taskDefinition = new ecs.FargateTaskDefinition(this, "taskDefinition", {
            cpu: props.cpu,
            taskRole: taskRole,
            memoryLimitMiB: props.memoryLimitMiB
        });
        this.taskDefinition.addToExecutionRolePolicy(EcsService.ExecutionRolePolicy);
        (_a = this.taskDefinition.taskRole) === null || _a === void 0 ? void 0 : _a.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(this, 'AmazonECSTaskExecutionRolePolicy', 'arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy'));
        (_b = this.taskDefinition.taskRole) === null || _b === void 0 ? void 0 : _b.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(this, 'AWSXrayWriteOnlyAccess', 'arn:aws:iam::aws:policy/AWSXrayWriteOnlyAccess'));
        // Build locally the image only if the repository URI is not specified
        // Can help speed up builds if we are not rebuilding anything
        const image = props.repositoryURI ? this.containerImageFromRepository(props.repositoryURI) : this.createContainerImage();
        this.container = this.taskDefinition.addContainer('container', {
            image: image,
            memoryLimitMiB: 512,
            cpu: 256,
            logging,
            environment: {
                AWS_REGION: props.region,
            }
        });
        this.container.addPortMappings({
            containerPort: 80,
            protocol: ecs.Protocol.TCP
        });
        /*
        this.taskDefinition.addFirelensLogRouter('firelensrouter', {
          firelensConfig: {
            type: ecs.FirelensLogRouterType.FLUENTBIT
          },
          image: ecs.ContainerImage.fromRegistry('public.ecr.aws/aws-observability/aws-for-fluent-bit:stable')
        })
       //*/
        // sidecar for instrumentation collecting
        switch (props.instrumentation) {
            // we don't add any sidecar if instrumentation is none
            case "none": {
                break;
            }
            // This collector would be used for both traces collected using
            // open telemetry or X-Ray
            case "otel": {
                this.addOtelCollectorContainer(this.taskDefinition, logging);
                break;
            }
            // Default X-Ray traces collector
            case "xray": {
                this.addXRayContainer(this.taskDefinition, logging);
                break;
            }
            // Default X-Ray traces collector
            // enabled by default
            default: {
                this.addXRayContainer(this.taskDefinition, logging);
                break;
            }
        }
        if (!props.disableService) {
            this.service = new ecs_patterns.ApplicationLoadBalancedFargateService(this, "ecs-service", {
                cluster: props.cluster,
                taskDefinition: this.taskDefinition,
                publicLoadBalancer: true,
                desiredCount: props.desiredTaskCount,
                listenerPort: 80,
                securityGroups: [props.securityGroup]
            });
            if (props.healthCheck) {
                this.service.targetGroup.configureHealthCheck({
                    path: props.healthCheck
                });
            }
        }
    }
    addXRayContainer(taskDefinition, logging) {
        taskDefinition.addContainer('xraydaemon', {
            image: ecs.ContainerImage.fromRegistry('public.ecr.aws/xray/aws-xray-daemon:3.3.4'),
            memoryLimitMiB: 256,
            cpu: 256,
            logging
        }).addPortMappings({
            containerPort: 2000,
            protocol: ecs.Protocol.UDP
        });
    }
    addOtelCollectorContainer(taskDefinition, logging) {
        taskDefinition.addContainer('aws-otel-collector', {
            image: ecs.ContainerImage.fromRegistry('public.ecr.aws/aws-observability/aws-otel-collector:v0.32.0'),
            memoryLimitMiB: 256,
            cpu: 256,
            command: ["--config", "/etc/ecs/ecs-xray.yaml"],
            logging
        });
    }
}
exports.EcsService = EcsService;
EcsService.ExecutionRolePolicy = new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    resources: ['*'],
    actions: [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "logs:CreateLogGroup",
        "logs:DescribeLogStreams",
        "logs:CreateLogStream",
        "logs:DescribeLogGroups",
        "logs:PutLogEvents",
        "xray:PutTraceSegments",
        "xray:PutTelemetryRecords",
        "xray:GetSamplingRules",
        "xray:GetSamplingTargets",
        "xray:GetSamplingStatisticSummaries",
        'ssm:GetParameters'
    ]
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZWNzLXNlcnZpY2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJlY3Mtc2VydmljZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSw2Q0FBNEM7QUFDNUMsMkNBQTJDO0FBQzNDLDJDQUEyQztBQUMzQyw2Q0FBNkM7QUFDN0MsNkRBQTZEO0FBRTdELDJDQUFzQztBQXVCdEMsTUFBc0IsVUFBVyxTQUFRLHNCQUFTO0lBNEJoRCxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQXNCOztRQUM5RCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1FBRWpCLE1BQU0sT0FBTyxHQUFHLElBQUksR0FBRyxDQUFDLFlBQVksQ0FBQztZQUNuQyxZQUFZLEVBQUUsTUFBTTtZQUNwQixRQUFRLEVBQUUsSUFBSSxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxlQUFlLEVBQUU7Z0JBQ2pELFlBQVksRUFBRSxLQUFLLENBQUMsWUFBWTtnQkFDaEMsYUFBYSxFQUFFLDJCQUFhLENBQUMsT0FBTzthQUNyQyxDQUFDO1NBQ0gsQ0FBQyxDQUFDO1FBRUg7Ozs7Ozs7Ozs7O1dBV0c7UUFFSCxNQUFNLFFBQVEsR0FBRyxJQUFJLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLFVBQVUsRUFBRTtZQUM5QyxTQUFTLEVBQUUsSUFBSSxHQUFHLENBQUMsZ0JBQWdCLENBQUMseUJBQXlCLENBQUM7U0FDL0QsQ0FBQyxDQUFDO1FBRUgsSUFBSSxDQUFDLGNBQWMsR0FBRyxJQUFJLEdBQUcsQ0FBQyxxQkFBcUIsQ0FBQyxJQUFJLEVBQUUsZ0JBQWdCLEVBQUU7WUFDMUUsR0FBRyxFQUFFLEtBQUssQ0FBQyxHQUFHO1lBQ2QsUUFBUSxFQUFFLFFBQVE7WUFDbEIsY0FBYyxFQUFFLEtBQUssQ0FBQyxjQUFjO1NBQ3JDLENBQUMsQ0FBQztRQUVILElBQUksQ0FBQyxjQUFjLENBQUMsd0JBQXdCLENBQUMsVUFBVSxDQUFDLG1CQUFtQixDQUFD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UmVtb3ZhbFBvbGljeSB9IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCAqIGFzIGVjcyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWNzJztcbmltcG9ydCAqIGFzIGxvZ3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxvZ3MnO1xuaW1wb3J0ICogYXMgZWNzX3BhdHRlcm5zIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lY3MtcGF0dGVybnMnO1xuaW1wb3J0ICogYXMgZWMyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lYzInO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cydcblxuZXhwb3J0IGludGVyZmFjZSBFY3NTZXJ2aWNlUHJvcHMge1xuICBjbHVzdGVyPzogZWNzLkNsdXN0ZXIsXG5cbiAgY3B1OiBudW1iZXI7XG4gIG1lbW9yeUxpbWl0TWlCOiBudW1iZXIsXG4gIGxvZ0dyb3VwTmFtZTogc3RyaW5nLFxuXG4gIGhlYWx0aENoZWNrPzogc3RyaW5nLFxuXG4gIGRpc2FibGVTZXJ2aWNlPzogYm9vbGVhbixcbiAgaW5zdHJ1bWVudGF0aW9uPzogc3RyaW5nLFxuXG4gIHJlcG9zaXRvcnlVUkk/OiBzdHJpbmcsXG5cbiAgZGVzaXJlZFRhc2tDb3VudDogbnVtYmVyLFxuXG4gIHJlZ2lvbjogc3RyaW5nLFxuXG4gIHNlY3VyaXR5R3JvdXA6IGVjMi5TZWN1cml0eUdyb3VwXG59XG5cbmV4cG9ydCBhYnN0cmFjdCBjbGFzcyBFY3NTZXJ2aWNlIGV4dGVuZHMgQ29uc3RydWN0IHtcblxuICBwcml2YXRlIHN0YXRpYyBFeGVjdXRpb25Sb2xlUG9saWN5ID0gbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgIGFjdGlvbnM6IFtcbiAgICAgIFwiZWNyOkdldEF1dGhvcml6YXRpb25Ub2tlblwiLFxuICAgICAgXCJlY3I6QmF0Y2hDaGVja0xheWVyQXZhaWxhYmlsaXR5XCIsXG4gICAgICBcImVjcjpHZXREb3dubG9hZFVybEZvckxheWVyXCIsXG4gICAgICBcImVjcjpCYXRjaEdldEltYWdlXCIsXG4gICAgICBcImxvZ3M6Q3JlYXRlTG9nR3JvdXBcIixcbiAgICAgIFwibG9nczpEZXNjcmliZUxvZ1N0cmVhbXNcIixcbiAgICAgIFwibG9nczpDcmVhdGVMb2dTdHJlYW1cIixcbiAgICAgIFwibG9nczpEZXNjcmliZUxvZ0dyb3Vwc1wiLFxuICAgICAgXCJsb2dzOlB1dExvZ0V2ZW50c1wiLFxuICAgICAgXCJ4cmF5OlB1dFRyYWNlU2VnbWVudHNcIixcbiAgICAgIFwieHJheTpQdXRUZWxlbWV0cnlSZWNvcmRzXCIsXG4gICAgICBcInhyYXk6R2V0U2FtcGxpbmdSdWxlc1wiLFxuICAgICAgXCJ4cmF5OkdldFNhbXBsaW5nVGFyZ2V0c1wiLFxuICAgICAgXCJ4cmF5OkdldFNhbXBsaW5nU3RhdGlzdGljU3VtbWFyaWVzXCIsXG4gICAgICAnc3NtOkdldFBhcmFtZXRlcnMnXG4gICAgXVxuICB9KTtcblxuICBwdWJsaWMgcmVhZG9ubHkgdGFza0RlZmluaXRpb246IGVjcy5UYXNrRGVmaW5pdGlvbjtcbiAgcHVibGljIHJlYWRvbmx5IHNlcnZpY2U6IGVjc19wYXR0ZXJucy5BcHBsaWNhdGlvbkxvYWRCYWxhbmNlZFNlcnZpY2VCYXNlO1xuICBwdWJsaWMgcmVhZG9ubHkgY29udGFpbmVyOiBlY3MuQ29udGFpbmVyRGVmaW5pdGlvbjtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogRWNzU2VydmljZVByb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkKTtcblxuICAgIGNvbnN0IGxvZ2dpbmcgPSBuZXcgZWNzLkF3c0xvZ0RyaXZlcih7XG4gICAgICBzdHJlYW1QcmVmaXg6IFwibG9nc1wiLFxuICAgICAgbG9nR3JvdXA6IG5ldyBsb2dzLkxvZ0dyb3VwKHRoaXMsIFwiZWNzLWxvZy1ncm91cFwiLCB7XG4gICAgICAgIGxvZ0dyb3VwTmFtZTogcHJvcHMubG9nR3JvdXBOYW1lLFxuICAgICAgICByZW1vdmFsUG9saWN5OiBSZW1vdmFsUG9saWN5LkRFU1RST1lcbiAgICAgIH0pXG4gICAgfSk7XG5cbiAgICAvKlxuICAgIGNvbnN0IGZpcmVsZW5zbG9nZ2luZyA9IG5ldyBlY3MuRmlyZUxlbnNMb2dEcml2ZXIoe1xuICAgICAgb3B0aW9uczoge1xuICAgICAgICBcIk5hbWVcIjogXCJjbG91ZHdhdGNoXCIsXG4gICAgICAgIFwicmVnaW9uXCI6IHByb3BzLnJlZ2lvbixcbiAgICAgICAgXCJsb2dfa2V5XCI6IFwibG9nXCIsXG4gICAgICAgIFwibG9nX2dyb3VwX25hbWVcIjogcHJvcHMubG9nR3JvdXBOYW1lLFxuICAgICAgICBcImF1dG9fY3JlYXRlX2dyb3VwXCI6IFwiZmFsc2VcIixcbiAgICAgICAgXCJsb2dfc3RyZWFtX25hbWVcIjogXCIkKGVjc190YXNrX2lkKVwiXG4gICAgICB9XG4gICAgfSk7XG4gICAvLyovXG5cbiAgICBjb25zdCB0YXNrUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCBgdGFza1JvbGVgLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnZWNzLXRhc2tzLmFtYXpvbmF3cy5jb20nKVxuICAgIH0pO1xuXG4gICAgdGhpcy50YXNrRGVmaW5pdGlvbiA9IG5ldyBlY3MuRmFyZ2F0ZVRhc2tEZWZpbml0aW9uKHRoaXMsIFwidGFza0RlZmluaXRpb25cIiwge1xuICAgICAgY3B1OiBwcm9wcy5jcHUsXG4gICAgICB0YXNrUm9sZTogdGFza1JvbGUsXG4gICAgICBtZW1vcnlMaW1pdE1pQjogcHJvcHMubWVtb3J5TGltaXRNaUJcbiAgICB9KTtcblxuICAgIHRoaXMudGFza0RlZmluaXRpb24uYWRkVG9FeGVjdXRpb25Sb2xlUG9saWN5KEVjc1NlcnZpY2UuRXhlY3V0aW9uUm9sZVBvbGljeSk7XG4gICAgdGhpcy50YXNrRGVmaW5pdGlvbi50YXNrUm9sZT8uYWRkTWFuYWdlZFBvbGljeShpYW0uTWFuYWdlZFBvbGljeS5mcm9tTWFuYWdlZFBvbGljeUFybih0aGlzLCAnQW1hem9uRUNTVGFza0V4ZWN1dGlvblJvbGVQb2xpY3knLCAnYXJuOmF3czppYW06OmF3czpwb2xpY3kvc2VydmljZS1yb2xlL0FtYXpvbkVDU1Rhc2tFeGVjdXRpb25Sb2xlUG9saWN5JykpO1xuICAgIHRoaXMudGFza0RlZmluaXRpb24udGFza1JvbGU/LmFkZE1hbmFnZWRQb2xpY3koaWFtLk1hbmFnZWRQb2xpY3kuZnJvbU1hbmFnZWRQb2xpY3lBcm4odGhpcywgJ0FXU1hyYXlXcml0ZU9ubHlBY2Nlc3MnLCAnYXJuOmF3czppYW06OmF3czpwb2xpY3kvQVdTWHJheVdyaXRlT25seUFjY2VzcycpKTtcblxuICAgIC8vIEJ1aWxkIGxvY2FsbHkgdGhlIGltYWdlIG9ubHkgaWYgdGhlIHJlcG9zaXRvcnkgVVJJIGlzIG5vdCBzcGVjaWZpZWRcbiAgICAvLyBDYW4gaGVscCBzcGVlZCB1cCBidWlsZHMgaWYgd2UgYXJlIG5vdCByZWJ1aWxkaW5nIGFueXRoaW5nXG4gICAgY29uc3QgaW1hZ2UgPSBwcm9wcy5yZXBvc2l0b3J5VVJJPyB0aGlzLmNvbnRhaW5lckltYWdlRnJvbVJlcG9zaXRvcnkocHJvcHMucmVwb3NpdG9yeVVSSSkgOiB0aGlzLmNyZWF0ZUNvbnRhaW5lckltYWdlKClcblxuICAgIHRoaXMuY29udGFpbmVyID0gdGhpcy50YXNrRGVmaW5pdGlvbi5hZGRDb250YWluZXIoJ2NvbnRhaW5lcicsIHtcbiAgICAgIGltYWdlOiBpbWFnZSxcbiAgICAgIG1lbW9yeUxpbWl0TWlCOiA1MTIsXG4gICAgICBjcHU6IDI1NixcbiAgICAgIGxvZ2dpbmcsXG4gICAgICBlbnZpcm9ubWVudDogeyAvLyBjbGVhciB0ZXh0LCBub3QgZm9yIHNlbnNpdGl2ZSBkYXRhXG4gICAgICAgIEFXU19SRUdJT046IHByb3BzLnJlZ2lvbixcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHRoaXMuY29udGFpbmVyLmFkZFBvcnRNYXBwaW5ncyh7XG4gICAgICBjb250YWluZXJQb3J0OiA4MCxcbiAgICAgIHByb3RvY29sOiBlY3MuUHJvdG9jb2wuVENQXG4gICAgfSk7XG5cbiAgICAvKlxuICAgIHRoaXMudGFza0RlZmluaXRpb24uYWRkRmlyZWxlbnNMb2dSb3V0ZXIoJ2ZpcmVsZW5zcm91dGVyJywge1xuICAgICAgZmlyZWxlbnNDb25maWc6IHtcbiAgICAgICAgdHlwZTogZWNzLkZpcmVsZW5zTG9nUm91dGVyVHlwZS5GTFVFTlRCSVRcbiAgICAgIH0sXG4gICAgICBpbWFnZTogZWNzLkNvbnRhaW5lckltYWdlLmZyb21SZWdpc3RyeSgncHVibGljLmVjci5hd3MvYXdzLW9ic2VydmFiaWxpdHkvYXdzLWZvci1mbHVlbnQtYml0OnN0YWJsZScpXG4gICAgfSlcbiAgIC8vKi9cblxuICAgIC8vIHNpZGVjYXIgZm9yIGluc3RydW1lbnRhdGlvbiBjb2xsZWN0aW5nXG4gICAgc3dpdGNoKHByb3BzLmluc3RydW1lbnRhdGlvbikge1xuXG4gICAgICAvLyB3ZSBkb24ndCBhZGQgYW55IHNpZGVjYXIgaWYgaW5zdHJ1bWVudGF0aW9uIGlzIG5vbmVcbiAgICAgIGNhc2UgXCJub25lXCI6IHtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG5cbiAgICAgIC8vIFRoaXMgY29sbGVjdG9yIHdvdWxkIGJlIHVzZWQgZm9yIGJvdGggdHJhY2VzIGNvbGxlY3RlZCB1c2luZ1xuICAgICAgLy8gb3BlbiB0ZWxlbWV0cnkgb3IgWC1SYXlcbiAgICAgIGNhc2UgXCJvdGVsXCI6IHtcbiAgICAgICAgdGhpcy5hZGRPdGVsQ29sbGVjdG9yQ29udGFpbmVyKHRoaXMudGFza0RlZmluaXRpb24sIGxvZ2dpbmcpO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cblxuICAgICAgLy8gRGVmYXVsdCBYLVJheSB0cmFjZXMgY29sbGVjdG9yXG4gICAgICBjYXNlIFwieHJheVwiOiB7XG4gICAgICAgIHRoaXMuYWRkWFJheUNvbnRhaW5lcih0aGlzLnRhc2tEZWZpbml0aW9uLCBsb2dnaW5nKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG5cbiAgICAgIC8vIERlZmF1bHQgWC1SYXkgdHJhY2VzIGNvbGxlY3RvclxuICAgICAgLy8gZW5hYmxlZCBieSBkZWZhdWx0XG4gICAgICBkZWZhdWx0OiB7XG4gICAgICAgIHRoaXMuYWRkWFJheUNvbnRhaW5lcih0aGlzLnRhc2tEZWZpbml0aW9uLCBsb2dnaW5nKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCFwcm9wcy5kaXNhYmxlU2VydmljZSkge1xuICAgICAgdGhpcy5zZXJ2aWNlID0gbmV3IGVjc19wYXR0ZXJucy5BcHBsaWNhdGlvbkxvYWRCYWxhbmNlZEZhcmdhdGVTZXJ2aWNlKHRoaXMsIFwiZWNzLXNlcnZpY2VcIiwge1xuICAgICAgICBjbHVzdGVyOiBwcm9wcy5jbHVzdGVyLFxuICAgICAgICB0YXNrRGVmaW5pdGlvbjogdGhpcy50YXNrRGVmaW5pdGlvbixcbiAgICAgICAgcHVibGljTG9hZEJhbGFuY2VyOiB0cnVlLFxuICAgICAgICBkZXNpcmVkQ291bnQ6IHByb3BzLmRlc2lyZWRUYXNrQ291bnQsXG4gICAgICAgIGxpc3RlbmVyUG9ydDogODAsXG4gICAgICAgIHNlY3VyaXR5R3JvdXBzOiBbcHJvcHMuc2VjdXJpdHlHcm91cF1cblxuICAgICAgfSlcblxuICAgICAgaWYgKHByb3BzLmhlYWx0aENoZWNrKSB7XG4gICAgICAgIHRoaXMuc2VydmljZS50YXJnZXRHcm91cC5jb25maWd1cmVIZWFsdGhDaGVjayh7XG4gICAgICAgICAgcGF0aDogcHJvcHMuaGVhbHRoQ2hlY2tcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgYWJzdHJhY3QgY29udGFpbmVySW1hZ2VGcm9tUmVwb3NpdG9yeShyZXBvc2l0b3J5VVJJOiBzdHJpbmcpIDogZWNzLkNvbnRhaW5lckltYWdlO1xuXG4gIGFic3RyYWN0IGNyZWF0ZUNvbnRhaW5lckltYWdlKCk6IGVjcy5Db250YWluZXJJbWFnZTtcblxuICBwcml2YXRlIGFkZFhSYXlDb250YWluZXIodGFza0RlZmluaXRpb246IGVjcy5GYXJnYXRlVGFza0RlZmluaXRpb24sIGxvZ2dpbmc6IGVjcy5Bd3NMb2dEcml2ZXIpIHtcbiAgICB0YXNrRGVmaW5pdGlvbi5hZGRDb250YWluZXIoJ3hyYXlkYWVtb24nLCB7XG4gICAgICBpbWFnZTogZWNzLkNvbnRhaW5lckltYWdlLmZyb21SZWdpc3RyeSgncHVibGljLmVjci5hd3MveHJheS9hd3MteHJheS1kYWVtb246My4zLjQnKSxcbiAgICAgIG1lbW9yeUxpbWl0TWlCOiAyNTYsXG4gICAgICBjcHU6IDI1NixcbiAgICAgIGxvZ2dpbmdcbiAgICB9KS5hZGRQb3J0TWFwcGluZ3Moe1xuICAgICAgY29udGFpbmVyUG9ydDogMjAwMCxcbiAgICAgIHByb3RvY29sOiBlY3MuUHJvdG9jb2wuVURQXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGFkZE90ZWxDb2xsZWN0b3JDb250YWluZXIodGFza0RlZmluaXRpb246IGVjcy5GYXJnYXRlVGFza0RlZmluaXRpb24sIGxvZ2dpbmc6IGVjcy5Bd3NMb2dEcml2ZXIpIHtcbiAgICB0YXNrRGVmaW5pdGlvbi5hZGRDb250YWluZXIoJ2F3cy1vdGVsLWNvbGxlY3RvcicsIHtcbiAgICAgICAgaW1hZ2U6IGVjcy5Db250YWluZXJJbWFnZS5mcm9tUmVnaXN0cnkoJ3B1YmxpYy5lY3IuYXdzL2F3cy1vYnNlcnZhYmlsaXR5L2F3cy1vdGVsLWNvbGxlY3Rvcjp2MC4zMi4wJyksXG4gICAgICAgIG1lbW9yeUxpbWl0TWlCOiAyNTYsXG4gICAgICAgIGNwdTogMjU2LFxuICAgICAgICBjb21tYW5kOiBbXCItLWNvbmZpZ1wiLCBcIi9ldGMvZWNzL2Vjcy14cmF5LnlhbWxcIl0sXG4gICAgICAgIGxvZ2dpbmdcbiAgICB9KTtcbiAgfVxufVxuIl19